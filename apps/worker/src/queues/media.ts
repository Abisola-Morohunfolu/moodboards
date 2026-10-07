import { createHash } from 'node:crypto';
import { Queue, JobsOptions } from 'bullmq';
import { MediaJob } from '@moodboard/contracts';
export const queueNames = ['process-image', 'fetch-preview'] as const;
export type QueueName = (typeof queueNames)[number];
export function redisConnection(value: string) {
  const url = new URL(value);
  if (
    !['redis:', 'rediss:'].includes(url.protocol) ||
    !/^\/\d*$/.test(url.pathname || '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid worker Redis configuration');
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
  };
}
export function jobId(job: MediaJob) {
  return `media-${job.entityId}-${createHash('sha256').update(job.generation).digest('hex').slice(0, 24)}`;
}
export function generation(row: { expiresAt: Date | null }): string {
  return row.expiresAt?.toISOString() ?? 'initial';
}
export const jobOptions: JobsOptions = {
  attempts: 10,
  backoff: { type: 'media' },
  removeOnComplete: { age: 31 * 86400 },
  removeOnFail: { age: 31 * 86400 },
};
export function backoff(attempt: number) {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 300_000);
}
export class MediaQueues {
  readonly queues: Record<QueueName, Queue<MediaJob>>;
  constructor(
    readonly url: string,
    readonly prefix = 'moodboard',
  ) {
    // Producers fail fast rather than retaining offline enqueue commands after a lease expires.
    const connection = {
      ...redisConnection(url),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    };
    this.queues = Object.fromEntries(
      queueNames.map((name) => [name, new Queue<MediaJob>(name, { connection, prefix })]),
    ) as Record<QueueName, Queue<MediaJob>>;
    for (const queue of Object.values(this.queues)) {
      queue.on('error', () => console.error('Media queue connection unavailable'));
    }
  }
  async add(name: QueueName, payload: MediaJob) {
    return this.queues[name].add(name, payload, { ...jobOptions, jobId: jobId(payload) });
  }
  async close() {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}
export async function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation deadline exceeded')), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
