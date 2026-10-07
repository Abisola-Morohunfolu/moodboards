import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  clientApprovalListSchema,
  plannerApprovalListSchema,
  decisionResponseSchema,
  DecisionRequest,
} from '@moodboard/contracts';
import { withTransaction } from '@moodboard/database';
import { validateEnvironment, ApiConfig } from '../apps/api/src/config';
import { ApprovalsRepository } from '../apps/api/src/features/approvals/approvals.repository';
import { ApprovalsService } from '../apps/api/src/features/approvals/approvals.service';
import { ClientsRepository } from '../apps/api/src/features/clients/clients.repository';
import { ClientsService } from '../apps/api/src/features/clients/clients.service';
import { ContactLinks } from '../apps/api/src/features/access/contact-links';
import { ContactSessionRepository } from '../apps/api/src/features/access/contact-session.repository';
import { ShareRepository } from '../apps/api/src/features/client-view/share.repository';
import { ParticipantsRepository } from '../apps/api/src/features/participants/participants.repository';
import { ParticipantsService } from '../apps/api/src/features/participants/participants.service';
import { ItemsRepository } from '../apps/api/src/features/items/items.repository';
import { ItemsService } from '../apps/api/src/features/items/items.service';
import { ItemPreviewsRepository } from '../apps/api/src/features/items/item-previews.repository';
import { boardServices, boardWorkspace } from './board-fixture';
import { testDataSource } from './database';

describe('Versioned approvals through mapped repositories', () => {
  const source = testDataSource(10);
  const core = boardServices(source);
  const approvals = new ApprovalsService(core.access, new ApprovalsRepository(), core.events);
  const clients = new ClientsService(
    source,
    new ClientsRepository(),
    core.events,
    core.accessRepository,
    approvals,
  );
  const links = new ContactLinks(
    new ConfigService<ApiConfig, true>(
      validateEnvironment({
        DATABASE_URL: 'postgres://test:test@localhost/moodboard_test',
        LINK_SECRET: 'x'.repeat(64),
        PUBLIC_API_URL: 'http://localhost:3001',
      }),
    ),
  );
  const participants = new ParticipantsService(
    core.access,
    new ParticipantsRepository(source),
    core.events,
    links,
    approvals,
  );
  const shares = new ShareRepository(links, core.accessRepository);
  const sessions = new ContactSessionRepository(source, links);
  const items = new ItemsService(
    core.access,
    new ItemsRepository(source),
    core.sectionsRepository,
    core.events,
    new ItemPreviewsRepository(),
    undefined,
    approvals,
  );
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    await source.query('truncate users, workspaces, link_previews cascade');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await source.query('truncate users, workspaces, link_previews cascade');
    await source.destroy();
  });

  async function setup() {
    const owner = await boardWorkspace(source, 'business');
    const client = await clients.create(owner.userId, owner.workspaceId, 'Client');
    const board = await core.boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Sign-off',
      clientId: client.id,
    });
    const item = (
      await items.create(owner.userId, board.id, {
        id: randomUUID(),
        kind: 'note',
        title: 'Lamp',
        zOrder: 'a0',
      })
    ).item;
    async function addContact(name: string, role: 'approver' | 'viewer' = 'approver') {
      const contact = await clients.createContact(owner.userId, client.id, { name });
      const { participant } = await participants.assign(owner.userId, board.id, {
        contactId: contact.id,
        role,
      });
      const url = (await participants.change(owner.userId, board.id, participant.id, 'link')) as {
        url: string;
      };
      const exchange = await withTransaction(source, (m) =>
        shares.exchange(m, url.url.split('/share/')[1]!),
      );
      return { contact, participant, principal: (await sessions.resolve(exchange.token))! };
    }
    const ada = await addContact('Ada');
    const ben = await addContact('Ben');
    const decision = (
      status: DecisionRequest['status'] = 'approved',
      comment: string | null = null,
    ): DecisionRequest => ({
      id: randomUUID(),
      itemId: item.id,
      itemVersion: item.version,
      status,
      comment,
    });
    return { ...owner, client, board, item, ada, ben, addContact, decision };
  }
  it('serializes concurrent approvals and requires every current approver', async () => {
    const f = await setup();
    const results = await Promise.all([
      approvals.decide(f.ada.principal, f.decision()),
      approvals.decide(f.ben.principal, f.decision()),
    ]);
    expect(results.map((r) => decisionResponseSchema.parse(r.body).approval.status).sort()).toEqual(
      ['approved', 'pending'],
    );
    const state = plannerApprovalListSchema.parse(
      await approvals.plannerList(f.userId, f.board.id),
    )[0]!;
    expect(state).toMatchObject({
      itemId: f.item.id,
      itemVersion: 1,
      status: 'approved',
      coreState: 'approved',
    });
    expect(state.decisions.map((d) => d.contactName).sort()).toEqual(['Ada', 'Ben']);
    expect(
      await source.query(
        "select count(*)::int as n from board_events where type='approval.state_changed' AND payload->>'coreState'='approved'",
      ),
    ).toEqual([{ n: 1 }]);
    const seqs = await source.query<{ board_seq: string }[]>(
      'select board_seq from board_events where board_id=$1 order by board_seq',
      [f.board.id],
    );
    expect(seqs.map((r) => Number(r.board_seq))).toEqual(seqs.map((_, index) => index + 1));
  });
  it('replays a decision snapshot after later decisions and a content edit without extra writes', async () => {
    const f = await setup();
    const input = f.decision();
    const first = await approvals.decide(f.ada.principal, input);
    expect(first.body.approval.status).toBe('pending');
    await approvals.decide(f.ben.principal, f.decision());
    await items.update(f.userId, f.item.id, { version: 1, title: 'New lamp' });
    const before = (await core.boards.get(f.userId, f.board.id)).board.eventSeq;
    expect(await approvals.decide(f.ada.principal, input)).toEqual({
      created: false,
      body: first.body,
    });
    expect((await core.boards.get(f.userId, f.board.id)).board.eventSeq).toBe(before);
    await expect(
      approvals.decide(f.ada.principal, { ...input, comment: 'Changed retry' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(approvals.decide(f.ben.principal, input)).rejects.toMatchObject({ status: 409 });
  });
  it('concurrent identical decision IDs produce one decision and one event', async () => {
    const f = await setup();
    const input = f.decision('rejected', 'Too large');
    const results = await Promise.all([
      approvals.decide(f.ada.principal, input),
      approvals.decide(f.ada.principal, input),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(await source.query('select count(*)::int as n from approval_decisions')).toEqual([
      { n: 1 },
    ]);
    expect(
      await source.query("select count(*)::int as n from board_events where type='item.decided'"),
    ).toEqual([{ n: 1 }]);
  });
  it('prioritizes swap requests and hides peer decisions from client responses', async () => {
    const f = await setup();
    await approvals.decide(f.ada.principal, f.decision('rejected', 'Private feedback'));
    await approvals.decide(f.ben.principal, f.decision('swap_requested', 'Different colour'));
    const ada = clientApprovalListSchema.parse(await approvals.clientList(f.ada.principal))[0]!;
    expect(ada).toMatchObject({
      status: 'swap_requested',
      coreState: 'rejected',
      ownDecision: { status: 'rejected', comment: 'Private feedback' },
    });
    expect(JSON.stringify(ada)).not.toContain('Different colour');
    const viewer = await f.addContact('Viewer', 'viewer');
    expect(
      clientApprovalListSchema.parse(await approvals.clientList(viewer.principal))[0]!.ownDecision,
    ).toBeNull();
    await expect(approvals.decide(viewer.principal, f.decision())).rejects.toMatchObject({
      status: 403,
    });
    const planner = plannerApprovalListSchema.parse(
      await approvals.plannerList(f.userId, f.board.id),
    )[0]!;
    expect(planner.decisions).toHaveLength(2);
    // New reads use only each participant's latest decision, with old history retained.
    await approvals.decide(f.ben.principal, f.decision('approved'));
    expect((await approvals.plannerList(f.userId, f.board.id))[0]!.status).toBe('rejected');
    expect(await source.query('select count(*)::int as n from approval_decisions')).toEqual([
      { n: 3 },
    ]);
  });
  it('reconciles pending sign-off after revocation and freezes it when a new approver joins', async () => {
    const f = await setup();
    await approvals.decide(f.ada.principal, f.decision());
    await participants.change(f.userId, f.board.id, f.ben.participant.id, 'revoke');
    expect((await approvals.plannerList(f.userId, f.board.id))[0]!.status).toBe('approved');
    const newcomer = await f.addContact('New approver');
    expect((await approvals.plannerList(f.userId, f.board.id))[0]!.status).toBe('approved');
    await expect(
      approvals.decide(newcomer.principal, f.decision('rejected')),
    ).rejects.toMatchObject({ status: 409 });
    await expect(approvals.decide(f.ben.principal, f.decision())).rejects.toMatchObject({
      status: 401,
    });
  });
  it('reconciles expired approvers and contact removal while retaining decision history', async () => {
    const f = await setup();
    await approvals.decide(f.ada.principal, f.decision());
    await source.query(
      "update board_participants set expires_at=now()-interval '1 second' where id=$1",
      [f.ben.participant.id],
    );
    expect((await approvals.clientList(f.ada.principal))[0]!.status).toBe('approved');
    const second = (
      await items.create(f.userId, f.board.id, { id: randomUUID(), kind: 'note', zOrder: 'b0' })
    ).item;
    await approvals.decide(f.ada.principal, {
      ...f.decision('rejected', 'Archived feedback'),
      itemId: second.id,
    });
    await clients.removeContact(f.userId, f.ada.contact.id);
    const rows = await approvals.plannerList(f.userId, f.board.id);
    expect(rows.find((r) => r.itemId === f.item.id)!.status).toBe('approved');
    expect(rows.find((r) => r.itemId === second.id)!.status).toBe('pending');
    expect(await source.query('select count(*)::int as n from approval_decisions')).toEqual([
      { n: 2 },
    ]);
    await expect(approvals.clientList(f.ada.principal)).rejects.toMatchObject({ status: 401 });
  });
  it('keeps sign-off on movement, resets on content edits, and ignores decisions from old versions', async () => {
    const f = await setup();
    await approvals.decide(f.ada.principal, f.decision());
    await approvals.decide(f.ben.principal, f.decision());
    const moved = await items.move(f.userId, f.item.id, { x: 12, y: 4 });
    expect(moved.version).toBe(1);
    expect((await approvals.plannerList(f.userId, f.board.id))[0]!.status).toBe('approved');
    const edited = await items.update(f.userId, f.item.id, {
      version: 1,
      priceCents: 2500,
      quantity: 2,
    });
    expect(edited.version).toBe(2);
    expect((await approvals.plannerList(f.userId, f.board.id))[0]).toMatchObject({
      itemVersion: 2,
      status: 'pending',
      coreState: 'pending',
      decisions: [],
    });
    await expect(approvals.decide(f.ada.principal, f.decision())).rejects.toMatchObject({
      status: 409,
    });
    const result = await approvals.decide(f.ada.principal, { ...f.decision(), itemVersion: 2 });
    expect(result.body.approval.status).toBe('pending');
    expect(await source.query('select count(*)::int as n from approval_decisions')).toEqual([
      { n: 3 },
    ]);
  });
  it('rolls back decisions, approval changes and content resets if event writing fails', async () => {
    const f = await setup();
    const before = (await core.boards.get(f.userId, f.board.id)).board.eventSeq;
    const original = core.events.append.bind(core.events);
    jest.spyOn(core.events, 'append').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('event failure');
    });
    await expect(approvals.decide(f.ada.principal, f.decision('rejected'))).rejects.toThrow(
      'event failure',
    );
    expect(await source.query('select * from approval_decisions')).toEqual([]);
    expect(await source.query('select * from approval_states')).toEqual([]);
    expect((await core.boards.get(f.userId, f.board.id)).board.eventSeq).toBe(before);
    jest.restoreAllMocks();
    await approvals.decide(f.ada.principal, f.decision());
    await approvals.decide(f.ben.principal, f.decision());
    const sequence = (await core.boards.get(f.userId, f.board.id)).board.eventSeq;
    jest.spyOn(core.events, 'append').mockImplementation(async (...args) => {
      const sequence = await original(...args);
      if (args[3].type === 'approval.state_changed') {
        throw new Error('reset failure');
      }
      return sequence;
    });
    await expect(
      items.update(f.userId, f.item.id, { version: 1, title: 'Changed' }),
    ).rejects.toThrow('reset failure');
    expect((await items.list(f.userId, f.board.id))[0]).toMatchObject({
      version: 1,
      title: 'Lamp',
    });
    expect((await approvals.plannerList(f.userId, f.board.id))[0]!.status).toBe('approved');
    expect((await core.boards.get(f.userId, f.board.id)).board.eventSeq).toBe(sequence);
  });
  it('rejects foreign and deleted items and caps locked boards at viewer', async () => {
    const f = await setup();
    const other = await core.boards.create(f.userId, {
      workspaceId: f.workspaceId,
      title: 'Other',
      clientId: f.client.id,
    });
    const foreign = (
      await items.create(f.userId, other.id, { id: randomUUID(), kind: 'note', zOrder: 'a0' })
    ).item;
    await expect(
      approvals.decide(f.ada.principal, { ...f.decision(), itemId: foreign.id }),
    ).rejects.toMatchObject({ status: 404 });
    await source.query('update boards set locked_at=now() where id=$1', [f.board.id]);
    await expect(approvals.decide(f.ada.principal, f.decision())).rejects.toMatchObject({
      status: 403,
    });
    await source.query('update boards set locked_at=null where id=$1', [f.board.id]);
    await items.delete(f.userId, f.item.id);
    await expect(approvals.decide(f.ada.principal, f.decision())).rejects.toMatchObject({
      status: 404,
    });
    expect(await approvals.clientList(f.ada.principal)).toEqual([]);
  });
});
