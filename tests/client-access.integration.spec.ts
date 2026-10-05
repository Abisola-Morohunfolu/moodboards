import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiConfig, validateEnvironment } from '../apps/api/src/config';
import { ClientsRepository } from '../apps/api/src/features/clients/clients.repository';
import { ClientsService } from '../apps/api/src/features/clients/clients.service';
import { ParticipantsRepository } from '../apps/api/src/features/participants/participants.repository';
import { ParticipantsService } from '../apps/api/src/features/participants/participants.service';
import { ContactLinks } from '../apps/api/src/features/access/contact-links';
import { ContactSessionRepository } from '../apps/api/src/features/access/contact-session.repository';
import {
  lockContactParents,
  ContactPrincipal,
} from '../apps/api/src/features/access/contact-access';
import { ShareRepository } from '../apps/api/src/features/client-view/share.repository';
import { withTransaction } from '@moodboard/database';
import { testDataSource } from './database';
import { boardServices, boardWorkspace, boardUser } from './board-fixture';

describe('Contact access transactions and isolation', () => {
  const source = testDataSource(10);
  const core = boardServices(source);
  const links = new ContactLinks(
    new ConfigService<ApiConfig, true>(
      validateEnvironment({
        DATABASE_URL: 'postgres://test:test@localhost/moodboard_test',
        LINK_SECRET: 'x'.repeat(64),
        PUBLIC_API_URL: 'http://localhost:3001',
      }),
    ),
  );
  const clients = new ClientsService(
    source,
    new ClientsRepository(),
    core.events,
    core.accessRepository,
  );
  const participants = new ParticipantsService(
    core.access,
    new ParticipantsRepository(source),
    core.events,
    links,
  );
  const shares = new ShareRepository(links, core.accessRepository);
  const sessions = new ContactSessionRepository(source, links);
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    await source.query('truncate users,workspaces cascade');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await source.query('truncate users,workspaces cascade');
    await source.destroy();
  });
  async function setup() {
    const owner = await boardWorkspace(source, 'business');
    const client = (await clients.create(owner.userId, owner.workspaceId, 'Client'))!;
    const contact = (await clients.createContact(owner.userId, client.id, { name: 'Ada' }))!;
    const board = await core.boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Board A',
      clientId: client.id,
    });
    const assignment = await participants.assign(owner.userId, board.id, {
      contactId: contact.id,
      role: 'approver',
    });
    const link = (await participants.change(
      owner.userId,
      board.id,
      assignment.participant.id,
      'link',
    )) as { url: string };
    const token = link.url.split('/share/')[1]!;
    const exchanged = await withTransaction(source, (m) => shares.exchange(m, token));
    const principal = (await sessions.resolve(exchanged.token))!;
    return {
      ...owner,
      client,
      contact,
      board,
      participant: assignment.participant,
      token,
      principal,
    };
  }
  async function waitForContactLock() {
    for (let i = 0; i < 200; i++) {
      const [row] =
        await source.query(`select count(*)::int as n from pg_stat_activity where datname=current_database()
        and wait_event_type='Lock' and query like 'select c.id from clients c join client_contacts%'`);
      if (row.n > 0) {
        return;
      }
      await delay(10);
    }
    throw new Error('Contact lock was not reached');
  }
  it('attaches once, permits same-client retries, and isolates clients and workspace roles', async () => {
    const f = await setup();
    const blank = await core.boards.create(f.userId, {
      workspaceId: f.workspaceId,
      title: 'Blank',
    });
    const assigned = await core.boards.update(f.userId, blank.id, { clientId: f.client.id });
    expect(assigned.clientId).toBe(f.client.id);
    expect(await core.boards.update(f.userId, blank.id, { clientId: f.client.id })).toEqual(
      assigned,
    );
    await expect(core.boards.update(f.userId, blank.id, { clientId: null })).rejects.toMatchObject({
      status: 409,
    });
    const other = (await clients.create(f.userId, f.workspaceId, 'Other'))!;
    await expect(
      core.boards.update(f.userId, blank.id, { clientId: other.id }),
    ).rejects.toMatchObject({ status: 409 });
    const foreignContact = (await clients.createContact(f.userId, other.id, { name: 'Other' }))!;
    await expect(
      participants.assign(f.userId, f.board.id, { contactId: foreignContact.id, role: 'viewer' }),
    ).rejects.toMatchObject({ status: 404 });
    const stranger = await boardWorkspace(source, 'business');
    await expect(
      core.boards.create(stranger.userId, {
        workspaceId: stranger.workspaceId,
        title: 'Foreign',
        clientId: f.client.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(clients.list(stranger.userId, f.workspaceId, false)).rejects.toMatchObject({
      status: 404,
    });
    const personal = await boardWorkspace(source, 'personal');
    await expect(clients.create(personal.userId, personal.workspaceId, 'No')).rejects.toMatchObject(
      { status: 403 },
    );
    const staff = await boardUser(source);
    await source.query("insert into workspace_members values($1,$2,'staff')", [
      f.workspaceId,
      staff,
    ]);
    expect(await clients.list(staff, f.workspaceId, false)).toHaveLength(2);
    await expect(
      participants.assign(staff, f.board.id, { contactId: f.contact.id, role: 'viewer' }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('keeps archived client access, but rejects new contacts, boards, and assignments', async () => {
    const f = await setup();
    const unassigned = await core.boards.create(f.userId, {
      workspaceId: f.workspaceId,
      title: 'Draft',
      clientId: f.client.id,
    });
    await clients.archive(f.userId, f.client.id);
    await clients.archive(f.userId, f.client.id);
    expect(await clients.list(f.userId, f.workspaceId, false)).toEqual([]);
    expect(await clients.list(f.userId, f.workspaceId, true)).toHaveLength(1);
    expect((await core.boards.get(f.principal, f.board.id)).role).toBe('approver');
    await expect(
      clients.createContact(f.userId, f.client.id, { name: 'New' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      core.boards.create(f.userId, {
        workspaceId: f.workspaceId,
        title: 'New',
        clientId: f.client.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      participants.assign(f.userId, unassigned.id, { contactId: f.contact.id, role: 'viewer' }),
    ).rejects.toMatchObject({ status: 409 });
    await participants.change(f.userId, f.board.id, f.participant.id, 'rotate');
  });
  it('preserves participant identity while revocation, expiry, restoration and rotation never revive old credentials', async () => {
    const f = await setup();
    const before = (await core.boards.get(f.userId, f.board.id)).board.eventSeq;
    const retry = await participants.assign(f.userId, f.board.id, {
      contactId: f.contact.id,
      role: 'approver',
    });
    expect(retry.participant.id).toBe(f.participant.id);
    expect((await core.boards.get(f.userId, f.board.id)).board.eventSeq).toBe(before);
    await participants.change(f.userId, f.board.id, f.participant.id, 'revoke');
    await participants.change(f.userId, f.board.id, f.participant.id, 'revoke');
    await expect(core.boards.get(f.principal, f.board.id)).rejects.toMatchObject({ status: 401 });
    await participants.assign(f.userId, f.board.id, { contactId: f.contact.id, role: 'viewer' });
    await expect(withTransaction(source, (m) => shares.exchange(m, f.token))).rejects.toMatchObject(
      { status: 404 },
    );
    await source.query(
      "update board_participants set expires_at=now()-interval '1 second' where id=$1",
      [f.participant.id],
    );
    await participants.assign(f.userId, f.board.id, { contactId: f.contact.id, role: 'approver' });
    expect((await participants.list(f.userId, f.board.id))[0]!.id).toBe(f.participant.id);
    await expect(
      participants.change(f.userId, f.board.id, f.participant.id, 'update', {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await source.query('select token_hash from contact_sessions where token_hash=$1', [
        f.principal.sessionHash,
      ]),
    ).toEqual([]);
  });
  it('rolls back anonymization, all grants and sessions when a multi-board event write fails', async () => {
    const f = await setup();
    const second = await core.boards.create(f.userId, {
      workspaceId: f.workspaceId,
      title: 'B',
      clientId: f.client.id,
    });
    await participants.assign(f.userId, second.id, { contactId: f.contact.id, role: 'viewer' });
    const original = core.events.append.bind(core.events);
    let calls = 0;
    jest.spyOn(core.events, 'append').mockImplementation(async (...args) => {
      if (++calls === 2) {
        throw new Error('Injected event failure');
      }
      return original(...args);
    });
    await expect(clients.removeContact(f.userId, f.contact.id)).rejects.toThrow(
      'Injected event failure',
    );
    expect(await clients.contacts(f.userId, f.client.id)).toHaveLength(1);
    expect((await core.boards.get(f.principal, f.board.id)).role).toBe('approver');
    expect(
      await source.query('select revoked_at from board_participants where contact_id=$1', [
        f.contact.id,
      ]),
    ).toEqual([{ revoked_at: null }, { revoked_at: null }]);
    jest.restoreAllMocks();
    await clients.removeContact(f.userId, f.contact.id);
    await clients.removeContact(f.userId, f.contact.id);
    expect(
      await source.query(
        'select name,email,removed_at is not null as removed from client_contacts where id=$1',
        [f.contact.id],
      ),
    ).toEqual([{ name: '', email: null, removed: true }]);
    expect(
      await source.query('select * from contact_sessions where contact_id=$1', [f.contact.id]),
    ).toEqual([]);
    await expect(core.boards.get(f.principal, f.board.id)).rejects.toMatchObject({ status: 401 });
  });
  it('rechecks a previously resolved principal after waiting behind revocation', async () => {
    const f = await setup();
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let reading: Promise<unknown> | undefined;
    try {
      await lockContactParents(runner.manager, f.contact.id);
      reading = core.boards.get(f.principal, f.board.id);
      const outcome = reading.then(
        () => 'allowed',
        (e: { status: number }) => e.status,
      );
      await waitForContactLock();
      await runner.query(
        'update board_participants set revoked_at=now(),link_version=link_version+1 where id=$1',
        [f.participant.id],
      );
      await runner.commitTransaction();
      expect(await outcome).toBe(401);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
      await reading?.catch(() => {});
    }
  });
  it('serializes exchange and assignment behind contact removal without granting access', async () => {
    const f = await setup();
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await lockContactParents(runner.manager, f.contact.id);
      const exchange = withTransaction(source, (m) => shares.exchange(m, f.token)).then(
        () => 200,
        (e: { status: number }) => e.status,
      );
      const assignment = participants
        .assign(f.userId, f.board.id, { contactId: f.contact.id, role: 'viewer' })
        .then(
          () => 200,
          (e: { status: number }) => e.status,
        );
      await waitForContactLock();
      await runner.query(
        "update client_contacts set removed_at=now(),name='',email=null where id=$1",
        [f.contact.id],
      );
      await runner.commitTransaction();
      expect(await exchange).toBe(404);
      expect(await assignment).toBe(404);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
    }
  });
  it('never allows a forged board context or an expired session', async () => {
    const f = await setup();
    await expect(core.boards.get(f.principal, randomUUID())).rejects.toMatchObject({ status: 404 });
    const forged: ContactPrincipal = { ...f.principal, boardId: randomUUID() };
    await expect(core.boards.get(forged, forged.boardId)).rejects.toMatchObject({ status: 401 });
    await source.query("update contact_sessions set expires_at=now()-interval '1 second'");
    await expect(core.boards.get(f.principal, f.board.id)).rejects.toMatchObject({ status: 401 });
  });
  it('updates role and expiry atomically, and reads the current role through an existing session', async () => {
    const f = await setup();
    const expiry = new Date(Date.now() + 86400_000).toISOString();
    const changed = await participants.change(f.userId, f.board.id, f.participant.id, 'update', {
      role: 'viewer',
      expiresAt: expiry,
    });
    expect(changed).toMatchObject({ role: 'viewer', expiresAt: expiry });
    expect((await core.boards.get(f.principal, f.board.id)).role).toBe('viewer');
    await participants.change(f.userId, f.board.id, f.participant.id, 'update', {
      role: 'approver',
      expiresAt: null,
    });
    expect((await core.boards.get(f.principal, f.board.id)).role).toBe('approver');
    const before = (await core.boards.get(f.userId, f.board.id)).board.eventSeq;
    await participants.change(f.userId, f.board.id, f.participant.id, 'update', {
      role: 'approver',
      expiresAt: null,
    });
    expect((await core.boards.get(f.userId, f.board.id)).board.eventSeq).toBe(before);
    await source.query('update boards set archived_at=now() where id=$1', [f.board.id]);
    expect((await core.boards.get(f.principal, f.board.id)).role).toBe('viewer');
  });
  it('rolls back a new assignment when its board event cannot commit', async () => {
    const f = await setup();
    const contact = (await clients.createContact(f.userId, f.client.id, { name: 'New' }))!;
    const before = (await core.boards.get(f.userId, f.board.id)).board.eventSeq;
    jest.spyOn(core.events, 'append').mockRejectedValue(new Error('Injected event failure'));
    await expect(
      participants.assign(f.userId, f.board.id, { contactId: contact.id, role: 'approver' }),
    ).rejects.toThrow('Injected event failure');
    expect(
      await source.query('select id from board_participants where contact_id=$1', [contact.id]),
    ).toEqual([]);
    expect((await core.boards.get(f.userId, f.board.id)).board.eventSeq).toBe(before);
  });
  it('rejects an old link exchange that waited behind rotation', async () => {
    const f = await setup();
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await lockContactParents(runner.manager, f.contact.id);
      const exchange = withTransaction(source, (m) => shares.exchange(m, f.token)).then(
        () => 200,
        (e: { status: number }) => e.status,
      );
      await waitForContactLock();
      await runner.query('select id from boards where id=$1 for update', [f.board.id]);
      await runner.query('update board_participants set link_version=link_version+1 where id=$1', [
        f.participant.id,
      ]);
      await runner.commitTransaction();
      expect(await exchange).toBe(404);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
    }
  });
});
