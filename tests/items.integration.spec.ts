import { randomUUID } from 'node:crypto';
import {
  BoardRole,
  noteConflictResponseSchema,
  noteListResponseSchema,
  noteResponseSchema,
} from '@moodboard/contracts';
import { ItemsRepository } from '../apps/api/src/features/items/items.repository';
import { ItemsService } from '../apps/api/src/features/items/items.service';
import { testDataSource } from './database';
import { boardServices, boardUser, boardWorkspace } from './board-fixture';

describe('Note content, positions, and atomic events', () => {
  const source = testDataSource(8);
  const { access, boards, sections, sectionsRepository, events } = boardServices(source);
  const items = new ItemsService(access, new ItemsRepository(source), sectionsRepository, events);
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    await source.query('truncate users, workspaces cascade');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await source.query('truncate users, workspaces cascade');
    await source.destroy();
  });
  async function create() {
    const owner = await boardWorkspace(source);
    const board = await boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Notes',
    });
    return { ...owner, board };
  }
  const input = () => ({
    id: randomUUID(),
    kind: 'note' as const,
    zOrder: 'a0',
    note: '  original\ncontent  ',
    priceCents: 2500,
  });
  it('serializes finite coordinates at the Postgres real bounds into valid responses', async () => {
    const { userId, board } = await create();
    const { item } = await items.create(userId, board.id, { ...input(), x: 3.402823466e38 });
    expect(Number.isFinite(noteResponseSchema.parse(item).x)).toBe(true);
    const moved = await items.move(userId, item.id, { x: -3.402823466e38 });
    expect(Number.isFinite(noteResponseSchema.parse(moved).x)).toBe(true);
  });
  it('creates one role-null actor identity on mutations without granting independent access', async () => {
    const { userId, workspaceId, board } = await create();
    const partner = await boardUser(source);
    await source.query("insert into workspace_members values ($1,$2,'partner')", [
      workspaceId,
      partner,
    ]);
    await source.query("update boards set general_access='workspace' where id=$1", [board.id]);
    const results = await Promise.all([
      items.create(partner, board.id, input()),
      items.create(partner, board.id, input()),
    ]);
    expect(results[0]!.item.createdBy).toBe(results[1]!.item.createdBy);
    expect(
      await source.query('select role from board_participants where board_id=$1 and user_id=$2', [
        board.id,
        partner,
      ]),
    ).toEqual([{ role: null }]);
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('3');
    await source.query("update boards set general_access='restricted' where id=$1", [board.id]);
    await expect(items.list(partner, board.id)).rejects.toMatchObject({ status: 404 });
  });
  it('serializes duplicate creates and preserves a deleted tombstone on retry', async () => {
    const { userId, board } = await create();
    const note = input();
    const results = await Promise.all([
      items.create(userId, board.id, note),
      items.create(userId, board.id, { ...note, note: 'ignored' }),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0]!.item).toEqual(results[1]!.item);
    expect(results[0]!.item).toMatchObject({
      x: 0,
      y: 0,
      sectionId: null,
      quantity: 1,
      version: 1,
    });
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('2');
    await items.delete(userId, note.id);
    await items.delete(userId, note.id);
    const retry = await items.create(userId, board.id, { ...note, sectionId: randomUUID() });
    expect(retry).toMatchObject({
      created: false,
      item: { deletedAt: expect.any(String), version: 1 },
    });
    expect(await items.list(userId, board.id)).toEqual([]);
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('3');
    await expect(
      items.update(userId, note.id, { version: 1, note: 'resurrect' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(items.move(userId, note.id, { x: 5 })).rejects.toMatchObject({ status: 404 });
  });
  it('rejects an id used on another board, including simultaneous saves', async () => {
    const { userId, workspaceId, board } = await create();
    const second = await boards.create(userId, { workspaceId, title: 'Second' });
    const note = input();
    const results = await Promise.allSettled([
      items.create(userId, board.id, note),
      items.create(userId, second.id, note),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ status: 409 });
    expect(
      await source.query(
        "select count(*)::int as count from board_events where type='item.created'",
      ),
    ).toEqual([{ count: 1 }]);
  });
  it('retries note creation with uppercase UUIDs while preserving cross-board conflicts', async () => {
    const { userId, workspaceId, board } = await create();
    const note = { ...input(), id: randomUUID().toUpperCase() };
    const created = await items.create(userId, board.id.toUpperCase(), note);
    const retried = await items.create(userId, board.id.toUpperCase(), {
      ...note,
      note: 'ignored',
    });
    expect(created.created).toBe(true);
    expect(retried).toEqual({ created: false, item: created.item });
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('2');
    const other = await boards.create(userId, { workspaceId, title: 'Other' });
    await expect(items.create(userId, other.id.toUpperCase(), note)).rejects.toMatchObject({
      status: 409,
    });
    expect((await boards.get(userId, other.id)).board.eventSeq).toBe('1');
  });
  it('allows one concurrent content edit and returns the winning item in a stale conflict', async () => {
    const { userId, board } = await create();
    const { item } = await items.create(userId, board.id, input());
    const results = await Promise.allSettled([
      items.update(userId, item.id, { version: 1, note: 'one' }),
      items.update(userId, item.id, { version: 1, note: 'two' }),
    ]);
    const winner = results.find(
      (result) => result.status === 'fulfilled',
    ) as PromiseFulfilledResult<unknown>;
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const conflict = noteConflictResponseSchema.parse(loser.reason.getResponse());
    expect(conflict.currentItem).toEqual(winner.value);
    expect(conflict.currentItem.version).toBe(2);
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('3');
  });
  it('moves independently of content version and never overwrites unrelated fields', async () => {
    const { userId, board } = await create();
    const { item } = await items.create(userId, board.id, input());
    await Promise.all([
      items.update(userId, item.id, { version: 1, note: 'edited', priceCents: null }),
      items.move(userId, item.id, { x: 12, y: 24, zOrder: 'Z0' }),
    ]);
    const [current] = noteListResponseSchema.parse(await items.list(userId, board.id));
    expect(current).toMatchObject({
      version: 2,
      note: 'edited',
      priceCents: null,
      x: 12,
      y: 24,
      zOrder: 'Z0',
    });
    await items.move(userId, item.id, { x: 40 });
    await items.move(userId, item.id, { x: 50 });
    expect((await items.list(userId, board.id))[0]).toMatchObject({ version: 2, x: 50, y: 24 });
    const rows = await source.query(
      'select board_seq from board_events where board_id=$1 order by board_seq',
      [board.id],
    );
    expect(rows.map((row: { board_seq: string }) => row.board_seq)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
  });
  it('returns section items to Unsorted without changing their content version', async () => {
    const { userId, board } = await create();
    const section = await sections.create(userId, board.id, { name: 'Section', position: 'a0' });
    const { item } = await items.create(userId, board.id, { ...input(), sectionId: section.id });
    await sections.delete(userId, board.id, section.id);
    expect((await items.list(userId, board.id))[0]).toMatchObject({
      id: item.id,
      sectionId: null,
      version: 1,
    });
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('4');
    expect(
      await items.create(userId, board.id, {
        id: item.id,
        kind: 'note',
        zOrder: 'a0',
        sectionId: section.id,
      }),
    ).toMatchObject({ created: false });
  });
  it('rejects foreign sections and sorts notes by byte order with stable id ties', async () => {
    const { userId, workspaceId, board } = await create();
    const other = await boards.create(userId, { workspaceId, title: 'Other' });
    const section = await sections.create(userId, other.id, { name: 'Foreign', position: 'a0' });
    await expect(
      items.create(userId, board.id, { ...input(), sectionId: section.id }),
    ).rejects.toMatchObject({ status: 404 });
    const notes = [input(), input(), { ...input(), zOrder: 'Z0' }];
    for (const note of notes) {
      await items.create(userId, board.id, note);
    }
    await expect(items.move(userId, notes[0]!.id, { sectionId: section.id })).rejects.toMatchObject(
      { status: 404 },
    );
    const expected = [...notes].sort((a, b) =>
      a.zOrder < b.zOrder ? -1 : a.zOrder > b.zOrder ? 1 : a.id.localeCompare(b.id),
    );
    expect((await items.list(userId, board.id)).map((item) => item.id)).toEqual(
      expected.map((note) => note.id),
    );
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('4');
  });
  it.each<BoardRole>(['viewer', 'approver', 'editor', 'owner'])(
    'enforces %s permissions and price visibility for account participants',
    async (role) => {
      const { userId, board } = await create();
      const { item } = await items.create(userId, board.id, input());
      const reader = await boardUser(source);
      await source.query(
        'insert into board_participants (id, board_id, user_id, role) values ($1,$2,$3,$4)',
        [randomUUID(), board.id, reader, role],
      );
      const [read] = await items.list(reader, board.id);
      expect(Object.hasOwn(read!, 'priceCents')).toBe(role === 'editor' || role === 'owner');
      if (role === 'viewer' || role === 'approver') {
        for (const action of [
          () => items.create(reader, board.id, input()),
          () => items.update(reader, item.id, { version: 1, note: 'denied' }),
          () => items.move(reader, item.id, { x: 9 }),
          () => items.delete(reader, item.id),
          () => sections.create(reader, board.id, { name: 'Denied', position: 'a0' }),
        ]) {
          await expect(action()).rejects.toMatchObject({ status: 403 });
        }
      } else {
        await items.update(reader, item.id, { version: 1, note: 'allowed' });
        await items.move(reader, item.id, { x: 9 });
        await items.delete(reader, item.id);
      }
      if (role !== 'owner') {
        await expect(boards.update(reader, board.id, { title: 'Denied' })).rejects.toMatchObject({
          status: 403,
        });
      }
    },
  );
  it.each(['locked_at', 'archived_at'])(
    'makes %s boards read-only for every role including owners',
    async (column) => {
      const { userId, board } = await create();
      const { item } = await items.create(userId, board.id, input());
      await source.query(`update boards set ${column}=now() where id=$1`, [board.id]);
      expect((await boards.get(userId, board.id)).role).toBe('viewer');
      expect((await items.list(userId, board.id))[0]).not.toHaveProperty('priceCents');
      for (const action of [
        () => items.update(userId, item.id, { version: 1, note: 'blocked' }),
        () => items.delete(userId, item.id),
        () => boards.update(userId, board.id, { title: 'Blocked' }),
      ]) {
        await expect(action()).rejects.toMatchObject({ status: 403 });
      }
    },
  );
  it('rolls back content, position, soft deletion, section removal, and sequence after event failure', async () => {
    const { userId, board } = await create();
    const section = await sections.create(userId, board.id, { name: 'Section', position: 'a0' });
    const { item } = await items.create(userId, board.id, { ...input(), sectionId: section.id });
    const append = events.append.bind(events);
    jest.spyOn(events, 'append').mockImplementation(async (...args) => {
      await append(...args);
      throw new Error('event failure');
    });
    for (const action of [
      () => items.create(userId, board.id, input()),
      () => items.update(userId, item.id, { version: 1, note: 'rollback' }),
      () => items.move(userId, item.id, { x: 100 }),
      () => items.delete(userId, item.id),
      () => sections.delete(userId, board.id, section.id),
    ]) {
      await expect(action()).rejects.toThrow('event failure');
    }
    expect(await items.list(userId, board.id)).toEqual([item]);
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('3');
    expect((await boards.get(userId, board.id)).sections).toEqual([section]);
  });
  it('serializes deletion against editing without resurrection', async () => {
    const { userId, board } = await create();
    const { item } = await items.create(userId, board.id, input());
    const results = await Promise.allSettled([
      items.delete(userId, item.id),
      items.update(userId, item.id, { version: 1, note: 'racing' }),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(await items.list(userId, board.id)).toEqual([]);
    const stored = await source.query('select deleted_at from items where id=$1', [item.id]);
    expect(stored[0].deleted_at).toBeInstanceOf(Date);
  });
  it('reauthorizes after waiting for the board lock', async () => {
    const { userId, board } = await create();
    const { item } = await items.create(userId, board.id, input());
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('select id from boards where id=$1 for update', [board.id]);
      const pending = expect(
        items.update(userId, item.id, { version: 1, note: 'too late' }),
      ).rejects.toMatchObject({ status: 404 });
      await runner.query(
        'update board_participants set revoked_at=now() where board_id=$1 and user_id=$2',
        [board.id, userId],
      );
      await runner.commitTransaction();
      await pending;
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
    }
    expect(await source.query('select version, note from items where id=$1', [item.id])).toEqual([
      { version: 1, note: '  original\ncontent  ' },
    ]);
  });
  it('never writes note text or monetary amounts into events', async () => {
    const { userId, board } = await create();
    const { item } = await items.create(userId, board.id, input());
    await items.update(userId, item.id, { version: 1, note: 'secret note', priceCents: 8888 });
    const rows = await source.query('select payload from board_events where board_id=$1', [
      board.id,
    ]);
    const payloads = JSON.stringify(rows);
    expect(payloads).not.toContain('secret note');
    expect(payloads).not.toContain('8888');
    expect(payloads).not.toContain('2500');
  });
});
