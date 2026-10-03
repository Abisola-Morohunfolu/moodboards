import { randomUUID } from 'node:crypto';
import {
  boardDetailResponseSchema,
  boardListResponseSchema,
  boardWithRoleResponseSchema,
} from '@moodboard/contracts';
import { testDataSource } from './database';
import { boardServices, boardUser, boardWorkspace } from './board-fixture';

describe('Board and section transactions', () => {
  const source = testDataSource(5);
  const { boards, sections, events, accessRepository } = boardServices(source);
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
  async function create(type: 'personal' | 'business' = 'personal') {
    const owner = await boardWorkspace(source, type);
    const board = await boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Wedding',
    });
    return { ...owner, board };
  }
  it.each(['personal', 'business'] as const)(
    'creates a complete blank board in a %s workspace',
    async (type) => {
      const { userId, board } = await create(type);
      expect(boardWithRoleResponseSchema.parse(board)).toMatchObject({
        role: 'owner',
        kitId: 'blank',
        layout: 'canvas',
        currency: null,
        generalAccess: 'restricted',
        eventSeq: '1',
      });
      const detail = boardDetailResponseSchema.parse(await boards.get(userId, board.id));
      expect(detail.sections).toEqual([]);
      expect(detail.modules).toEqual([]);
      const rows = await source.query(
        'select type, board_seq, payload, participant_id, fanned_out_at, dispatched_at from board_events where board_id=$1',
        [board.id],
      );
      expect(rows).toEqual([
        {
          type: 'board.created',
          board_seq: '1',
          payload: { boardId: board.id },
          participant_id: expect.any(String),
          fanned_out_at: null,
          dispatched_at: null,
        },
      ]);
    },
  );
  it('rejects cross-workspace creation and reads without partial writes', async () => {
    const { board, workspaceId } = await create();
    const stranger = await boardUser(source);
    for (const promise of [
      boards.create(stranger, { workspaceId, title: 'Hidden' }),
      boards.get(stranger, board.id),
      boards.list(stranger, workspaceId),
    ]) {
      await expect(promise).rejects.toMatchObject({ status: 404 });
    }
    expect(await source.query('select count(*)::int as count from boards')).toEqual([{ count: 1 }]);
  });
  it('keeps a partner-created restricted board private from the personal workspace owner', async () => {
    const { userId, workspaceId } = await boardWorkspace(source);
    const partner = await boardUser(source);
    await source.query("insert into workspace_members values ($1,$2,'partner')", [
      workspaceId,
      partner,
    ]);
    const board = await boards.create(partner, { workspaceId, title: 'Surprise' });
    await expect(boards.get(userId, board.id)).rejects.toMatchObject({ status: 404 });
    expect(await boards.list(userId, workspaceId)).toEqual([]);
    expect((await boards.get(partner, board.id)).role).toBe('owner');
  });
  it('filters both lists with the role resolver and gives role-null identities no independent grant', async () => {
    const { userId, workspaceId, board } = await create();
    const partner = await boardUser(source);
    await source.query("insert into workspace_members values ($1,$2,'partner')", [
      workspaceId,
      partner,
    ]);
    expect(await boards.list(partner, workspaceId)).toEqual([]);
    await expect(boards.get(partner, board.id)).rejects.toMatchObject({ status: 404 });
    await source.query("update boards set general_access='workspace' where id=$1", [board.id]);
    expect(boardListResponseSchema.parse(await boards.list(partner, workspaceId))).toMatchObject([
      { id: board.id, role: 'editor' },
    ]);
    expect(await boards.list(partner)).toEqual([]);
    await Promise.all([boards.get(partner, board.id), boards.get(partner, board.id)]);
    expect(await boards.list(partner)).toMatchObject([{ id: board.id, role: 'editor' }]);
    expect(
      await source.query('select role from board_participants where board_id=$1 and user_id=$2', [
        board.id,
        partner,
      ]),
    ).toEqual([{ role: null }]);
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('1');
    await source.query("update boards set general_access='restricted' where id=$1", [board.id]);
    expect(await boards.list(partner)).toEqual([]);
    expect(await boards.list(partner, workspaceId)).toEqual([]);
  });
  it('preserves business recovery but revocation and expiry block other participants and lists', async () => {
    const { userId, workspaceId, board } = await create('business');
    const staff = await boardUser(source);
    await source.query("insert into workspace_members values ($1,$2,'staff')", [
      workspaceId,
      staff,
    ]);
    await source.query("update boards set general_access='workspace' where id=$1", [board.id]);
    await boards.get(staff, board.id);
    for (const column of ['revoked_at', 'expires_at']) {
      await source.query(
        `update board_participants set revoked_at=${column === 'revoked_at' ? 'now()' : 'null'}, expires_at=${column === 'expires_at' ? 'now()' : 'null'} where board_id=$1`,
        [board.id],
      );
      await expect(boards.get(staff, board.id)).rejects.toMatchObject({ status: 404 });
      expect(await boards.list(staff)).toEqual([]);
      expect(await boards.list(staff, workspaceId)).toEqual([]);
      expect((await boards.get(userId, board.id)).role).toBe('owner');
    }
  });
  it('rolls back board creation after an event has incremented the sequence', async () => {
    const owner = await boardWorkspace(source);
    const append = events.append.bind(events);
    jest.spyOn(events, 'append').mockImplementationOnce(async (...args) => {
      await append(...args);
      throw new Error('injected failure');
    });
    await expect(
      boards.create(owner.userId, { workspaceId: owner.workspaceId, title: 'Rollback' }),
    ).rejects.toThrow('injected failure');
    for (const table of ['boards', 'board_participants', 'board_events']) {
      expect(await source.query(`select count(*)::int as count from ${table}`)).toEqual([
        { count: 0 },
      ]);
    }
  });
  it('rolls back participant creation failure and keeps opening a board event-free', async () => {
    const { userId, workspaceId, board } = await create('business');
    const anotherOwner = await boardUser(source);
    await source.query("insert into workspace_members values ($1,$2,'owner')", [
      workspaceId,
      anotherOwner,
    ]);
    const ensure = accessRepository.ensureParticipant.bind(accessRepository);
    jest.spyOn(accessRepository, 'ensureParticipant').mockImplementationOnce(async (...args) => {
      await ensure(...args);
      throw new Error('participant failure');
    });
    await expect(boards.get(anotherOwner, board.id)).rejects.toThrow('participant failure');
    expect(
      await source.query('select id from board_participants where user_id=$1', [anotherOwner]),
    ).toEqual([]);
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('1');
  });
  it('writes board updates and section changes in contiguous order under concurrent requests', async () => {
    const { userId, board } = await create();
    const results = await Promise.all([
      boards.update(userId, board.id, { title: 'New title' }),
      sections.create(userId, board.id, { name: 'Lower', position: 'a' }),
      sections.create(userId, board.id, { name: 'Upper', position: 'Z' }),
    ]);
    const lower = results[1];
    await sections.update(userId, board.id, lower.id, { name: 'Renamed', position: 'b' });
    const detail = await boards.get(userId, board.id);
    expect(detail.board).toMatchObject({ title: 'New title', eventSeq: '5' });
    expect(detail.sections.map((section) => section.name)).toEqual(['Upper', 'Renamed']);
    await sections.delete(userId, board.id, lower.id);
    expect(
      await source.query(
        'select board_seq from board_events where board_id=$1 order by board_seq',
        [board.id],
      ),
    ).toEqual(['1', '2', '3', '4', '5', '6'].map((board_seq) => ({ board_seq })));
  });
  it('rejects cross-board section updates and deletes without touching either board', async () => {
    const { userId, workspaceId, board } = await create();
    const other = await boards.create(userId, { workspaceId, title: 'Other' });
    const section = await sections.create(userId, other.id, { name: 'Other', position: 'a0' });
    await expect(
      sections.update(userId, board.id, section.id, { name: 'Bad' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(sections.delete(userId, board.id, section.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await boards.get(userId, board.id)).board.eventSeq).toBe('1');
    expect((await boards.get(userId, other.id)).sections).toEqual([section]);
    await expect(boards.get(userId, randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
