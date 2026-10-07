import { randomUUID } from 'node:crypto';
import { Dispatcher } from '../apps/worker/src/dispatcher/dispatcher';
import { MediaQueues, jobId } from '../apps/worker/src/queues/media';
import { MediaProcessors } from '../apps/worker/src/jobs/processors';
import { Maintenance } from '../apps/worker/src/jobs/maintenance';
import { ItemsService } from '../apps/api/src/features/items/items.service';
import { ItemsRepository } from '../apps/api/src/features/items/items.repository';
import { ItemPreviewsRepository } from '../apps/api/src/features/items/item-previews.repository';
import { testDataSource } from './database';
import { testRedisUrl } from './redis';
import { testStorage } from './storage';
import { R2Storage } from '@moodboard/storage';
import { boardWorkspace, boardServices } from './board-fixture';
describe('Leased outbox deliveries and recovery', () => {
  const source = testDataSource(10);
  const services = boardServices(source);
  const items = new ItemsService(
    services.access,
    new ItemsRepository(source),
    services.sectionsRepository,
    services.events,
    new ItemPreviewsRepository(),
  );
  let queues: MediaQueues;
  let dispatcher: Dispatcher;
  let storage: R2Storage;
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    storage = await testStorage();
  });
  beforeEach(async () => {
    await source.query('truncate users,workspaces,link_previews cascade');
    queues = new MediaQueues(testRedisUrl(), `dispatch-${randomUUID()}`);
    await Promise.all(Object.values(queues.queues).map((q) => q.waitUntilReady()));
    dispatcher = new Dispatcher(source, queues);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const q of Object.values(queues.queues)) {
      await q.obliterate({ force: true });
    }
    await queues.close();
  });
  afterAll(async () => {
    storage?.close();
    await source.query('truncate users,workspaces,link_previews cascade');
    await source.destroy();
  });
  async function link() {
    const owner = await boardWorkspace(source);
    const board = await services.boards.create(owner.userId, {
      workspaceId: owner.workspaceId,
      title: 'Outbox',
    });
    const { item } = await items.create(owner.userId, board.id, {
      kind: 'link',
      url: 'https://example.com/product',
      id: randomUUID(),
      zOrder: 'a0',
    });
    if (item.kind !== 'link') {
      throw new Error('Expected link');
    }
    return { board, previewId: item.preview.id };
  }
  it('lets two dispatchers fan out and claim each event only once', async () => {
    await link();
    const other = new Dispatcher(source, queues);
    await Promise.all([dispatcher.fanout(), other.fanout()]);
    expect(await source.query('select target,attempts from board_event_deliveries')).toEqual([
      { target: 'fetch-preview', attempts: 0 },
    ]);
    const claims = await Promise.all([dispatcher.claim(), other.claim()]);
    expect(claims.flat()).toHaveLength(1);
    expect(
      await source.query(
        "select dispatched_at is not null as done from board_events where type='board.created'",
      ),
    ).toEqual([{ done: true }]);
  });
  it('recovers a crash after enqueue without another job and rejects an expired lease acknowledgement', async () => {
    const { previewId } = await link();
    await dispatcher.fanout();
    const first = (await dispatcher.claim())[0]!;
    const payload = await dispatcher.payload(first);
    await queues.add(first.target, payload!);
    await source.query("update board_event_deliveries set lease_until=now()-interval '1 second'");
    const second = (await dispatcher.claim())[0]!;
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await dispatcher.acknowledge(first, true);
    expect(await source.query('select done_at from board_event_deliveries')).toEqual([
      { done_at: null },
    ]);
    await queues.add(second.target, (await dispatcher.payload(second))!);
    await dispatcher.acknowledge(second, true);
    await dispatcher.finalize();
    expect(await queues.queues['fetch-preview'].getJobCounts('waiting')).toMatchObject({
      waiting: 1,
    });
    expect(
      await queues.queues['fetch-preview'].getJob(
        jobId({ entityId: previewId, generation: 'initial' }),
      ),
    ).toBeDefined();
    expect(
      await source.query(
        'select dispatched_at is not null as done from board_events order by board_seq',
      ),
    ).toEqual([{ done: true }, { done: true }]);
  });
  it('retains committed content during queue failure and terminates a crashed tenth attempt', async () => {
    await link();
    jest.spyOn(queues, 'add').mockRejectedValue(new Error('offline'));
    await dispatcher.tick();
    expect(
      await source.query(
        'select attempts,done_at,failed_at,lease_token from board_event_deliveries',
      ),
    ).toEqual([{ attempts: 1, done_at: null, failed_at: null, lease_token: null }]);
    expect(await source.query('select kind from items')).toEqual([{ kind: 'link' }]);
    await source.query(
      "update board_event_deliveries set attempts=10,lease_until=now()-interval '1 second'",
    );
    expect(await dispatcher.claim()).toEqual([]);
    await dispatcher.finalize();
    expect(
      await source.query('select failed_at is not null as failed from board_event_deliveries'),
    ).toEqual([{ failed: true }]);
  });
  it('reconstructs a missing pending job from current rows', async () => {
    const { previewId } = await link();
    const processors = new MediaProcessors(source, storage, {
      fetch: async () => ({ url: 'https://example.com', html: '<title>Preview</title>' }),
    });
    const maintenance = new Maintenance(source, storage, queues, processors);
    await maintenance.reconcile();
    await maintenance.reconcile();
    expect(await queues.queues['fetch-preview'].getJobCounts('waiting')).toMatchObject({
      waiting: 1,
    });
    await processors.preview({ entityId: previewId, generation: 'initial' });
    await maintenance.reconcile();
    expect(await source.query('select status from link_previews')).toEqual([{ status: 'ready' }]);
  });
});
