import { createServer, Server } from 'node:http';
import { Worker, UnrecoverableError } from 'bullmq';
import { Client } from 'pg';
import { DataSource } from '@moodboard/database';
import { mediaJobSchema, MediaJob } from '@moodboard/contracts';
import { Storage } from '@moodboard/storage';
import { Dispatcher } from './dispatcher/dispatcher';
import { MediaProcessors } from './jobs/processors';
import { InvalidMedia } from './jobs/egress';
import { Maintenance, maintenanceDay } from './jobs/maintenance';
import { MediaQueues, queueNames, redisConnection, backoff, deadline } from './queues/media';
export interface RuntimeOptions {
  redisUrl: string;
  databaseUrl: string;
  prefix?: string;
  host?: string;
  port?: number;
}
export class WorkerRuntime {
  readonly queues: MediaQueues;
  readonly dispatcher: Dispatcher;
  readonly maintenance: Maintenance;
  private readonly workers: Worker<MediaJob>[] = [];
  private listener: Client | null = null;
  private listenerConnecting = false;
  private server: Server | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: Promise<void> | null = null;
  private stopping = false;
  private lastReconcile = 0;
  private lastDay: string | null = null;
  constructor(
    readonly source: DataSource,
    readonly storage: Storage,
    readonly processors: MediaProcessors,
    readonly options: RuntimeOptions,
  ) {
    this.queues = new MediaQueues(options.redisUrl, options.prefix);
    this.dispatcher = new Dispatcher(source, this.queues);
    this.maintenance = new Maintenance(source, storage, this.queues, processors);
  }
  get healthPort(): number | null {
    const address = this.server?.address();
    return address && typeof address !== 'string' ? address.port : null;
  }
  async ready() {
    await deadline(
      Promise.all([
        this.source.query('select lease_token,lease_until from board_event_deliveries limit 0'),
        ...Object.values(this.queues.queues).map((queue) =>
          queue.waitUntilReady().then(async () => (await queue.getBackend().client).info()),
        ),
        this.storage.ready(),
      ]),
      2000,
    );
  }
  async start() {
    await this.ready();
    for (const name of queueNames) {
      const worker = new Worker<MediaJob>(
        name,
        async (job) => {
          const payload = mediaJobSchema.parse(job.data);
          try {
            if (name === 'process-image') {
              await this.processors.image(payload);
            } else {
              await this.processors.preview(payload);
            }
          } catch (error) {
            const permanent = error instanceof InvalidMedia;
            if (permanent || job.attemptsMade + 1 >= 10) {
              await this.processors.fail(name, payload);
            }
            console.error(
              JSON.stringify({
                operation: 'media-processing',
                jobId: job.id,
                attempt: job.attemptsMade + 1,
                terminal: permanent || job.attemptsMade + 1 >= 10,
              }),
            );
            if (permanent) {
              throw new UnrecoverableError('Invalid media');
            }
            throw new Error('Media processing unavailable');
          }
        },
        {
          connection: redisConnection(this.options.redisUrl),
          prefix: this.queues.prefix,
          concurrency: name === 'process-image' ? 2 : 4,
          settings: { backoffStrategy: (attempt) => backoff(attempt) },
        },
      );
      worker.on('error', () => console.error('Media worker connection unavailable'));
      this.workers.push(worker);
    }
    await this.connectListener();
    this.server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/health/live') {
        response.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (request.url !== '/health/ready') {
        response.statusCode = 404;
        response.end('{}');
        return;
      }
      void this.ready().then(
        () => response.end(JSON.stringify({ status: 'ok' })),
        () => {
          response.statusCode = 503;
          response.end(JSON.stringify({ status: 'down' }));
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.options.port ?? 3002, this.options.host ?? '127.0.0.1', resolve);
    });
    this.timer = setInterval(() => this.schedule(), 5000);
    this.schedule();
  }
  private async connectListener() {
    if (this.listener || this.listenerConnecting || this.stopping) {
      return;
    }
    this.listenerConnecting = true;
    const client = new Client({
      connectionString: this.options.databaseUrl,
      connectionTimeoutMillis: 2000,
    });
    const lost = () => {
      if (this.listener === client) {
        this.listener = null;
      }
      void client.end().catch(() => undefined);
    };
    client.on('error', lost);
    client.on('end', lost);
    client.on('notification', () => this.schedule());
    try {
      await client.connect();
      await client.query('LISTEN board_events');
      this.listener = client;
    } catch {
      await client.end().catch(() => undefined);
    } finally {
      this.listenerConnecting = false;
    }
  }
  private schedule() {
    if (this.active || this.stopping) {
      return;
    }
    this.active = this.cycle()
      .catch(() => console.error('Worker cycle unavailable'))
      .finally(() => {
        this.active = null;
      });
  }
  private async cycle() {
    await this.connectListener();
    await this.dispatcher.tick();
    const now = new Date();
    if (now.getTime() - this.lastReconcile >= 60_000) {
      await this.maintenance.reconcile();
      this.lastReconcile = now.getTime();
    }
    const day = maintenanceDay(now);
    if (day && day !== this.lastDay) {
      // Session advisory locking elects one maintenance runner across instances.
      const runner = this.source.createQueryRunner();
      await runner.connect();
      try {
        const [lock]: { held: boolean }[] = await runner.query(
          "select pg_try_advisory_lock(hashtextextended('media-maintenance',0)) as held",
        );
        if (lock?.held) {
          try {
            await this.maintenance.daily(now);
            this.lastDay = day;
          } finally {
            await runner.query(
              "select pg_advisory_unlock(hashtextextended('media-maintenance',0))",
            );
          }
        }
      } finally {
        await runner.release();
      }
    }
  }
  async close() {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    // A cycle may still be reconnecting and assign its listener while shutdown waits.
    await this.active;
    if (this.listener) {
      const client = this.listener;
      this.listener = null;
      await client.end();
    }
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.queues.close();
  }
}
