import { randomUUID, createHash } from 'node:crypto';
import {
  AssetEntity,
  BoardEntity,
  BoardEventEntity,
  BoardEventDeliveryEntity,
  BoardParticipantEntity,
  ItemEntity,
  LinkPreviewEntity,
  UserEntity,
  WorkspaceMemberEntity,
  appendBoardEvent,
  databaseEntities,
  entityFromRow,
  withTransaction,
} from '@moodboard/database';
import { testDataSource } from './database';
import { boardServices, boardWorkspace } from './board-fixture';

interface CatalogColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  defaultValue: string | null;
  identity: string;
}
describe('Shared database entity mappings', () => {
  const source = testDataSource(3);
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  beforeEach(async () => {
    await source.query('truncate users, workspaces, link_previews cascade');
  });
  afterAll(async () => {
    await source.query('truncate users, workspaces, link_previews cascade');
    await source.destroy();
  });
  it.each(databaseEntities)(
    '%p maps every column and key of its migrated table',
    async (target) => {
      const metadata = source.getMetadata(target);
      const rows = await source.query<CatalogColumn[]>(
        `
      SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
        NOT a.attnotnull AS nullable,
        EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS primary,
        pg_get_expr(d.adbin, d.adrelid) AS "defaultValue", a.attidentity AS identity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attname`,
        [metadata.tableName],
      );
      const expected = metadata.columns
        .map((column) => ({
          name: column.databaseName,
          type:
            column.type === 'enum'
              ? column.enumName
              : source.driver.normalizeType(column) +
                (column.length ? `(${column.length})` : '') +
                (column.isArray ? '[]' : ''),
          nullable: column.isNullable,
          primary: column.isPrimary,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(
        rows.map(({ name, type, nullable, primary }) => ({ name, type, nullable, primary })),
      ).toEqual(expected);
      for (const column of metadata.columns.filter((c) => c.default !== undefined)) {
        expect(rows.find((r) => r.name === column.databaseName)?.defaultValue).not.toBeNull();
      }
      expect(metadata.versionColumn).toBeUndefined();
      expect(metadata.updateDateColumn).toBeUndefined();
      expect(metadata.deleteDateColumn).toBeUndefined();
      if (target === BoardEventEntity) {
        expect(rows.find((r) => r.name === 'id')?.identity).toBe('a');
      }
    },
  );
  it('round trips camelCase fields, defaults, nullable values, buffers, arrays, JSON and real coordinates', async () => {
    const owner = await boardWorkspace(source, 'business');
    const { boards } = boardServices(source);
    const board = await boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Mappings',
      currency: 'USD',
    });
    const participant = await source.manager
      .createQueryBuilder(BoardParticipantEntity, 'p')
      .where('p.boardId = :id', { id: board.id })
      .getOneOrFail();
    const assetId = randomUUID();
    const previewId = randomUUID();
    const itemId = randomUUID();
    const urlHash = createHash('sha256').update('https://example.com').digest();
    await source.manager
      .createQueryBuilder()
      .insert()
      .into(AssetEntity)
      .values({
        id: assetId,
        boardId: board.id,
        storageKey: 'original',
        mimeType: 'image/png',
        bytes: 100,
        palette: ['#000000', '#ffffff'],
      })
      .execute();
    await source.manager
      .createQueryBuilder()
      .insert()
      .into(LinkPreviewEntity)
      .values({ id: previewId, url: 'https://example.com', urlHash })
      .execute();
    const inserted = await source.manager
      .createQueryBuilder()
      .insert()
      .into(ItemEntity)
      .values({
        id: itemId,
        boardId: board.id,
        createdBy: participant.id,
        kind: 'image',
        zOrder: 'a0',
        assetId,
        x: 13.5,
        y: -42.25,
        title: null,
        attributes: { nested: { enabled: true }, tags: ['lamp'] },
      })
      .returning('*')
      .execute();
    const item = entityFromRow(source.manager, ItemEntity, inserted.raw[0]);
    expect(item).toBeInstanceOf(ItemEntity);
    expect(item).toMatchObject({
      id: itemId,
      boardId: board.id,
      assetId,
      x: 13.5,
      y: -42.25,
      title: null,
      sectionId: null,
      quantity: 1,
      version: 1,
      rotation: 0,
      attributes: { nested: { enabled: true }, tags: ['lamp'] },
    });
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
    expect(
      await source.manager
        .createQueryBuilder(ItemEntity, 'item')
        .where('item.id = :id', { id: itemId })
        .getOne(),
    ).toEqual(item);
    const asset = await source.manager
      .createQueryBuilder(AssetEntity, 'a')
      .where('a.id = :id', { id: assetId })
      .getOneOrFail();
    expect(asset).toMatchObject({
      status: 'pending',
      thumbnailKey: null,
      width: null,
      height: null,
      palette: ['#000000', '#ffffff'],
    });
    const preview = await source.manager
      .createQueryBuilder(LinkPreviewEntity, 'p')
      .where('p.id = :id', { id: previewId })
      .getOneOrFail();
    expect(preview.urlHash.equals(urlHash)).toBe(true);
    expect(preview.fetchedAt).toBeNull();
    const user = await source.manager
      .createQueryBuilder(UserEntity, 'u')
      .where('u.id = :id', { id: owner.userId })
      .getOneOrFail();
    expect(user.passwordHash).toBeNull();
    const membership = await source.manager
      .createQueryBuilder(WorkspaceMemberEntity, 'm')
      .where('m.workspaceId = :workspaceId AND m.userId = :userId', owner)
      .getOneOrFail();
    expect(membership.role).toBe('owner');
  });
  it('keeps bigint sequences and event IDs precise and maps composite delivery keys', async () => {
    const owner = await boardWorkspace(source);
    const board = await boardServices(source).boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Bigint',
    });
    const sequence = '9007199254740993';
    await source.manager
      .createQueryBuilder()
      .update(BoardEntity)
      .set({ eventSeq: sequence })
      .where('id = :id', { id: board.id })
      .execute();
    expect(
      await withTransaction(source, (manager) =>
        appendBoardEvent(manager, board.id, null, {
          type: 'test.created',
          payload: { itemId: randomUUID() },
        }),
      ),
    ).toBe('9007199254740994');
    // OVERRIDING is deliberate here: exercise hydration beyond Number.MAX_SAFE_INTEGER.
    await source.query(
      "INSERT INTO board_events(id, board_id, board_seq, type) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'test.precise')",
      [sequence, board.id, '9007199254740995'],
    );
    const event = await source.manager
      .createQueryBuilder(BoardEventEntity, 'e')
      .where('e.id = :id', { id: sequence })
      .getOneOrFail();
    expect(event.id).toBe(sequence);
    expect(event.boardSeq).toBe('9007199254740995');
    await source.manager
      .createQueryBuilder()
      .insert()
      .into(BoardEventDeliveryEntity)
      .values({ eventId: sequence, target: 'fetch-preview' })
      .execute();
    const delivery = await source.manager
      .createQueryBuilder(BoardEventDeliveryEntity, 'd')
      .where('d.eventId = :id AND d.target = :target', { id: sequence, target: 'fetch-preview' })
      .getOneOrFail();
    expect(delivery).toMatchObject({
      eventId: sequence,
      target: 'fetch-preview',
      attempts: 0,
      leaseToken: null,
      leaseUntil: null,
    });
  });
  it('rolls back entity writes and the event on the same transaction connection', async () => {
    const owner = await boardWorkspace(source);
    const board = await boardServices(source).boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Rollback',
    });
    const id = randomUUID();
    const before = await source.manager
      .createQueryBuilder(BoardEntity, 'b')
      .where('b.id = :id', { id: board.id })
      .getOneOrFail();
    const failure = new Error('injected after outbox');
    await expect(
      withTransaction(source, async (manager) => {
        const [{ pid }] = await manager.query('select pg_backend_pid() as pid');
        const participant = await manager
          .createQueryBuilder(BoardParticipantEntity, 'p')
          .where('p.boardId = :id', { id: board.id })
          .getOneOrFail();
        await manager
          .createQueryBuilder()
          .insert()
          .into(ItemEntity)
          .values({ id, boardId: board.id, createdBy: participant.id, kind: 'note', zOrder: 'a0' })
          .execute();
        await appendBoardEvent(manager, board.id, participant.id, {
          type: 'item.created',
          payload: { itemId: id },
        });
        expect(await manager.query('select pg_backend_pid() as pid')).toEqual([{ pid }]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      await source.manager
        .createQueryBuilder(ItemEntity, 'i')
        .where('i.id = :id', { id })
        .getExists(),
    ).toBe(false);
    expect(
      (
        await source.manager
          .createQueryBuilder(BoardEntity, 'b')
          .where('b.id = :id', { id: board.id })
          .getOneOrFail()
      ).eventSeq,
    ).toBe(before.eventSeq);
    expect(
      await source.manager
        .createQueryBuilder(BoardEventEntity, 'e')
        .where('e.boardId = :id', { id: board.id })
        .getCount(),
    ).toBe(1);
  });
});
