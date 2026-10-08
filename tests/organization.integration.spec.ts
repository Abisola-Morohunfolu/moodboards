import { randomUUID } from 'node:crypto';
import { workspaceSearchResponseSchema, trashPageResponseSchema } from '@moodboard/contracts';
import { SearchService } from '../apps/api/src/features/search/search.service';
import { ItemsService } from '../apps/api/src/features/items/items.service';
import { ItemsRepository } from '../apps/api/src/features/items/items.repository';
import { ItemPreviewsRepository } from '../apps/api/src/features/items/item-previews.repository';
import { ApprovalsService } from '../apps/api/src/features/approvals/approvals.service';
import { ApprovalsRepository } from '../apps/api/src/features/approvals/approvals.repository';
import { Dispatcher } from '../apps/worker/src/dispatcher/dispatcher';
import { MaintenanceRepository } from '../apps/worker/src/jobs/maintenance.repository';
import { MediaQueues } from '../apps/worker/src/queues/media';
import { boardServices, boardWorkspace, boardUser } from './board-fixture';
import { testDataSource } from './database';

describe('Workspace search and recoverable board trash', () => {
  const source = testDataSource(8);
  const services = boardServices(source);
  const repository = new ItemsRepository(source);
  const approvals = new ApprovalsService(
    services.access,
    new ApprovalsRepository(),
    services.events,
  );
  const items = new ItemsService(
    services.access,
    repository,
    services.sectionsRepository,
    services.events,
    new ItemPreviewsRepository(),
    undefined,
    approvals,
  );
  const search = new SearchService(source, services.accessRepository, repository);
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    await source.query('truncate users, workspaces, link_previews cascade');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await source.query('truncate users, workspaces, link_previews cascade');
    await source.destroy();
  });
  async function fixture(type: 'personal' | 'business' = 'personal') {
    const owner = await boardWorkspace(source, type);
    const board = await services.boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Summer ideas',
    });
    return { ...owner, board };
  }
  async function note(userId: string, boardId: string, title = 'Summer note', sectionId?: string) {
    return (
      await items.create(userId, boardId, {
        id: randomUUID(),
        kind: 'note',
        title,
        note: 'An everyday plan',
        priceCents: 750,
        x: 150,
        y: 180,
        zOrder: 'a0',
        sectionId,
      })
    ).item;
  }
  async function deleted(userId: string, boardId: string, id: string) {
    await items.delete(userId, id);
    return (await items.trash(userId, boardId, {})).items.find((item) => item.id === id)!;
  }
  it('searches titles, notes, and saved link metadata with case-insensitive literal matching', async () => {
    const f = await fixture();
    const section = await services.sections.create(f.userId, f.board.id, {
      name: 'Living room',
      position: 'a0',
    });
    const n = await note(f.userId, f.board.id, '50%_off\\sale', section.id);
    const link = (
      await items.create(f.userId, f.board.id, {
        id: randomUUID(),
        kind: 'link',
        zOrder: 'a1',
        url: 'https://example.com/catalog',
      })
    ).item;
    if (link.kind !== 'link') {
      throw new Error('Expected link');
    }
    await source.query(
      "update link_previews set title='Found furniture', description='Velvet upholstery', site_name='Design store' where id=$1",
      [link.preview.id],
    );
    const boardMatch = workspaceSearchResponseSchema.parse(
      await search.find(f.userId, f.workspaceId, { q: 'SUMMER' }),
    );
    expect(boardMatch.results.map((hit) => hit.type)).toEqual(['board']);
    for (const q of [
      '50%_off\\sale',
      'everyday',
      'example.com/catalog',
      'furniture',
      'velvet',
      'design store',
    ]) {
      const page = workspaceSearchResponseSchema.parse(
        await search.find(f.userId, f.workspaceId, { q }),
      );
      expect({ q, results: page.results }).toMatchObject({ q, results: [expect.anything()] });
      expect(page.results[0]).toMatchObject({
        type: 'item',
        item: { id: q === '50%_off\\sale' || q === 'everyday' ? n.id : link.id },
      });
    }
    expect(
      (await search.find(f.userId, f.workspaceId, { q: '50%_off\\sale' })).results[0],
    ).toMatchObject({ section });
    await deleted(f.userId, f.board.id, n.id);
    expect((await search.find(f.userId, f.workspaceId, { q: 'everyday' })).results).toEqual([]);
  });
  it('filters by board and kind, pages across board/item boundaries, and binds cursors to their search', async () => {
    const f = await fixture();
    for (let index = 0; index < 22; index++) {
      await note(f.userId, f.board.id);
    }
    // Identical timestamps exercise the UUID tie-breaker without dropping rows.
    await source.query("update items set created_at='2026-01-01T00:00:00.123456Z'");
    const first = await search.find(f.userId, f.workspaceId, { q: 'summer' });
    expect(first.results).toHaveLength(20);
    expect(first.results[0]!.type).toBe('board');
    const second = await search.find(f.userId, f.workspaceId, {
      q: 'summer',
      cursor: first.nextCursor!,
    });
    expect(second.results).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.results, ...second.results].map((hit) =>
          hit.type === 'board' ? hit.board.id : hit.item.id,
        ),
      ).size,
    ).toBe(23);
    expect(
      (await search.find(f.userId, f.workspaceId, { q: 'summer', kind: 'link' })).results,
    ).toEqual([]);
    expect(
      (
        await search.find(f.userId, f.workspaceId, {
          q: 'summer',
          kind: 'note',
          boardId: f.board.id,
        })
      ).results.every((hit) => hit.type === 'item'),
    ).toBe(true);
    await expect(
      search.find(f.userId, f.workspaceId, { q: 'other', cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      search.find(f.userId, f.workspaceId, { q: 'summer', cursor: 'broken' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('uses current board roles before search, excludes private and expired grants, and redacts prices', async () => {
    const f = await fixture();
    const partner = await boardUser(source);
    await source.query(
      "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'partner')",
      [f.workspaceId, partner],
    );
    const n = await note(f.userId, f.board.id);
    expect((await search.find(partner, f.workspaceId, { q: 'summer' })).results).toEqual([]);
    await expect(
      search.find(partner, f.workspaceId, { q: 'summer', boardId: f.board.id }),
    ).rejects.toMatchObject({ status: 404 });
    await source.query(
      "update boards set general_access='workspace', workspace_default_role='viewer' where id=$1",
      [f.board.id],
    );
    const result = await search.find(partner, f.workspaceId, { q: 'note' });
    expect(result.results[0]).toMatchObject({ type: 'item', item: { id: n.id } });
    expect(result.results[0]!.type === 'item' && result.results[0]!.item).not.toHaveProperty(
      'priceCents',
    );
    expect(
      await source.query('select id from board_participants where user_id=$1', [partner]),
    ).toEqual([]);
    await source.query(
      "insert into board_participants(id,board_id,user_id,role,expires_at) values($1,$2,$3,'viewer',now()-interval '1 second')",
      [randomUUID(), f.board.id, partner],
    );
    expect((await search.find(partner, f.workspaceId, { q: 'summer' })).results).toEqual([]);
    await source.query(
      'update board_participants set expires_at=null,revoked_at=now() where user_id=$1',
      [partner],
    );
    expect((await search.find(partner, f.workspaceId, { q: 'summer' })).results).toEqual([]);
    const outsider = await boardUser(source);
    await expect(search.find(outsider, f.workspaceId, { q: 'summer' })).rejects.toMatchObject({
      status: 404,
    });
    const other = await fixture();
    await note(other.userId, other.board.id);
    expect(
      (await search.find(f.userId, f.workspaceId, { q: 'summer' })).results.map(
        (hit) => hit.board.id,
      ),
    ).not.toContain(other.board.id);
  });
  it('restores unchanged content and position, handles retries, and rejects a stale marker after re-deletion', async () => {
    const f = await fixture();
    const original = await note(f.userId, f.board.id);
    const tombstone = await deleted(f.userId, f.board.id, original.id);
    const input = { deletedAt: tombstone.deletedAt! };
    const restored = await items.restore(f.userId, original.id, input);
    expect(restored).toMatchObject({ ...original, deletedAt: null, updatedAt: expect.any(String) });
    await Promise.all([
      items.restore(f.userId, original.id, input),
      items.restore(f.userId, original.id, input),
    ]);
    expect(
      await source.query(
        "select count(*)::int as count from board_events where type='item.restored'",
      ),
    ).toEqual([{ count: 1 }]);
    const newer = await deleted(f.userId, f.board.id, original.id);
    expect(newer.deletedAt).not.toBe(tombstone.deletedAt);
    await expect(items.restore(f.userId, original.id, input)).rejects.toMatchObject({
      status: 409,
    });
    expect(await items.list(f.userId, f.board.id)).toEqual([]);
    await items.restore(f.userId, original.id, { deletedAt: newer.deletedAt! });
  });
  it('returns items from removed sections to Unsorted and rolls back restoration if the event fails', async () => {
    const f = await fixture();
    const section = await services.sections.create(f.userId, f.board.id, {
      name: 'Room',
      position: 'a0',
    });
    const original = await note(f.userId, f.board.id, 'Saved', section.id);
    const tombstone = await deleted(f.userId, f.board.id, original.id);
    await services.sections.delete(f.userId, f.board.id, section.id);
    const append = jest
      .spyOn(services.events, 'append')
      .mockRejectedValueOnce(new Error('event unavailable'));
    await expect(
      items.restore(f.userId, original.id, { deletedAt: tombstone.deletedAt! }),
    ).rejects.toThrow('event unavailable');
    expect(await items.list(f.userId, f.board.id)).toEqual([]);
    append.mockRestore();
    expect(
      await items.restore(f.userId, original.id, { deletedAt: tombstone.deletedAt! }),
    ).toMatchObject({ sectionId: null, version: original.version });
  });
  it('keeps deletion markers advancing across edits, moves, and section removal when the clock moves backwards', async () => {
    const f = await fixture();
    const section = await services.sections.create(f.userId, f.board.id, {
      name: 'Room',
      position: 'a0',
    });
    const original = await note(f.userId, f.board.id, 'Saved', section.id);
    await source.query("update items set updated_at=now()+interval '1 hour' where id=$1", [
      original.id,
    ]);
    const tombstone = await deleted(f.userId, f.board.id, original.id);
    await items.restore(f.userId, original.id, { deletedAt: tombstone.deletedAt! });
    await items.update(f.userId, original.id, { version: original.version, title: 'Edited' });
    await items.move(f.userId, original.id, { x: 10, y: 20 });
    await services.sections.delete(f.userId, f.board.id, section.id);
    const newer = await deleted(f.userId, f.board.id, original.id);
    expect(new Date(newer.deletedAt!).getTime()).toBeGreaterThan(
      new Date(tombstone.deletedAt!).getTime(),
    );
    await expect(
      items.restore(f.userId, original.id, { deletedAt: tombstone.deletedAt! }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('paginates trash and denies viewer/approver/locked-board restoration', async () => {
    const f = await fixture();
    for (let index = 0; index < 23; index++) {
      const n = await note(f.userId, f.board.id);
      await items.delete(f.userId, n.id);
    }
    const first = trashPageResponseSchema.parse(await items.trash(f.userId, f.board.id, {}));
    const second = await items.trash(f.userId, f.board.id, { cursor: first.nextCursor! });
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(3);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(23);
    const viewer = await boardUser(source);
    const pid = randomUUID();
    await source.query(
      "insert into board_participants(id,board_id,user_id,role) values($1,$2,$3,'viewer')",
      [pid, f.board.id, viewer],
    );
    for (const role of ['viewer', 'approver']) {
      await source.query('update board_participants set role=$1 where id=$2', [role, pid]);
      await expect(items.trash(viewer, f.board.id, {})).rejects.toMatchObject({ status: 403 });
      await expect(
        items.restore(viewer, first.items[0]!.id, { deletedAt: first.items[0]!.deletedAt! }),
      ).rejects.toMatchObject({ status: 403 });
    }
    await source.query('update boards set locked_at=now() where id=$1', [f.board.id]);
    await expect(
      items.restore(f.userId, first.items[0]!.id, { deletedAt: first.items[0]!.deletedAt! }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('retains historical approvals and frozen approved versions after restoration', async () => {
    const f = await fixture('business');
    const clientId = randomUUID();
    await source.query('insert into clients(id,workspace_id,name) values($1,$2,$3)', [
      clientId,
      f.workspaceId,
      'Client',
    ]);
    await source.query('update boards set client_id=$1 where id=$2', [clientId, f.board.id]);
    const n = await note(f.userId, f.board.id);
    await source.query(
      "insert into approval_states(item_id,item_version,status,core_state) values($1,$2,'approved','approved')",
      [n.id, n.version],
    );
    const contactId = randomUUID(),
      participantId = randomUUID(),
      decisionId = randomUUID();
    await source.query('insert into client_contacts(id,client_id,name) values($1,$2,$3)', [
      contactId,
      clientId,
      'Reviewer',
    ]);
    await source.query(
      "insert into board_participants(id,board_id,contact_id,role) values($1,$2,$3,'approver')",
      [participantId, f.board.id, contactId],
    );
    await source.query(
      "insert into approval_decisions(id,item_id,item_version,participant_id,status,comment,result_status,result_core_state) values($1,$2,$3,$4,'approved','Keep this','approved','approved')",
      [decisionId, n.id, n.version, participantId],
    );
    const tombstone = await deleted(f.userId, f.board.id, n.id);
    await items.restore(f.userId, n.id, { deletedAt: tombstone.deletedAt! });
    expect(await source.query('select id,comment,item_version from approval_decisions')).toEqual([
      { id: decisionId, comment: 'Keep this', item_version: n.version },
    ]);
    expect((await approvals.plannerList(f.userId, f.board.id))[0]).toMatchObject({
      itemVersion: n.version,
      status: 'approved',
      coreState: 'approved',
    });
  });
  it('fans out restored media, keeps failed images failed, and preserves storage references in trash', async () => {
    const f = await fixture();
    const participant = (
      await source.query('select id from board_participants where board_id=$1', [f.board.id])
    )[0].id;
    const dispatcher = new Dispatcher(source, {} as MediaQueues);
    const maintenance = new MaintenanceRepository();
    for (const status of ['pending', 'failed', 'ready']) {
      const assetId = randomUUID(),
        id = randomUUID();
      await source.query(
        "insert into assets(id,board_id,storage_key,mime_type,bytes,status,created_at) values($1,$2,$3,'image/png',10,$4,now()-interval '2 days')",
        [assetId, f.board.id, `asset/${assetId}`, status],
      );
      await source.query(
        "insert into items(id,board_id,created_by,kind,asset_id,z_order) values($1,$2,$3,'image',$4,'a0')",
        [id, f.board.id, participant, assetId],
      );
      const tombstone = await deleted(f.userId, f.board.id, id);
      expect(await maintenance.orphanAssets(source.manager, new Date())).toEqual([]);
      const restored = await items.restore(f.userId, id, { deletedAt: tombstone.deletedAt! });
      expect(restored).toMatchObject({ kind: 'image', asset: { id: assetId, status } });
    }
    const link = (
      await items.create(f.userId, f.board.id, {
        id: randomUUID(),
        kind: 'link',
        zOrder: 'a1',
        url: 'https://example.com/restored',
      })
    ).item;
    const tombstone = await deleted(f.userId, f.board.id, link.id);
    await items.restore(f.userId, link.id, { deletedAt: tombstone.deletedAt! });
    await dispatcher.fanout();
    const claims = await dispatcher.claim();
    const payloads = await Promise.all(claims.map((claim) => dispatcher.payload(claim)));
    expect(payloads.filter(Boolean).map((payload) => payload!.generation)).toEqual(
      expect.arrayContaining(['initial']),
    );
    expect(
      await source.query(
        "select count(*)::int as count from board_event_deliveries d join board_events e on e.id=d.event_id where e.type='item.restored'",
      ),
    ).toEqual([{ count: 4 }]);
  });
});
