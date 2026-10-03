import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, Notification } from 'pg';
import { testDatabaseUrl, testDataSource } from './database';

describe('Schema constraints and event notifications', () => {
  const source = testDataSource();
  const user = randomUUID();
  const workspace = randomUUID();
  const board = randomUUID();
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    await source.query('insert into users (id, email, display_name) values ($1, $2, $3)', [
      user,
      'Planner@example.com',
      'Planner',
    ]);
    await source.query("insert into workspaces (id, type, name) values ($1, 'business', 'Test')", [
      workspace,
    ]);
    await source.query(
      'insert into boards (id, workspace_id, created_by, title) values ($1, $2, $3, $4)',
      [board, workspace, user, 'Test'],
    );
  });
  afterEach(async () => {
    await source.query('delete from workspaces where id=$1', [workspace]);
    await source.query('delete from users where id=$1', [user]);
  });
  afterAll(async () => {
    if (source.isInitialized) {
      await source.destroy();
    }
  });

  it('rejects emails that differ only in letter case', async () => {
    await expect(
      source.query('insert into users (id, email, display_name) values ($1, $2, $3)', [
        randomUUID(),
        'planner@EXAMPLE.COM',
        'Duplicate',
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });
  it('rejects a missing user reference', async () => {
    await expect(
      source.query("insert into workspace_members values ($1, $2, 'owner')", [
        workspace,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
  it('rejects a section from a different board', async () => {
    const otherBoard = randomUUID();
    const section = randomUUID();
    const participant = randomUUID();
    await source.query(
      'insert into boards (id, workspace_id, created_by, title) values ($1, $2, $3, $4)',
      [otherBoard, workspace, user, 'Other'],
    );
    await source.query('insert into sections values ($1, $2, $3, $4)', [
      section,
      otherBoard,
      'Other section',
      'a',
    ]);
    await source.query(
      "insert into board_participants (id, board_id, user_id, role) values ($1, $2, $3, 'owner')",
      [participant, board, user],
    );
    await expect(
      source.query(
        'insert into items (id, board_id, section_id, created_by, kind, z_order) values ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), board, section, participant, 'note', 'a'],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
  });
  it('notifies after commit and does not notify after rollback', async () => {
    const listener = new Client({ connectionString: testDatabaseUrl() });
    const messages: Notification[] = [];
    const runner = source.createQueryRunner();
    await listener.connect();
    listener.on('notification', (message) => messages.push(message));
    try {
      await listener.query('listen board_events');
      await runner.connect();
      await runner.startTransaction();
      const [event] = await runner.query(
        "insert into board_events (board_id, board_seq, type) values ($1, 1, 'test.created') returning id",
        [board],
      );
      await listener.query('select 1');
      expect(messages).toHaveLength(0);
      await runner.commitTransaction();
      // A listener query forms a protocol barrier after the writer commit.
      await listener.query('select 1');
      for (let attempt = 0; messages.length === 0 && attempt < 20; attempt++) {
        await delay(10);
      }
      expect(messages.map(({ payload }) => payload)).toEqual([event.id]);
      await runner.startTransaction();
      await runner.query(
        "insert into board_events (board_id, board_seq, type) values ($1, 2, 'test.cancelled')",
        [board],
      );
      await runner.rollbackTransaction();
      await listener.query('select 1');
      expect(messages.map(({ payload }) => payload)).toEqual([event.id]);
      expect(
        await source.query('select board_seq from board_events where board_id=$1', [board]),
      ).toEqual([{ board_seq: '1' }]);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
      await listener.end();
    }
  });
});
