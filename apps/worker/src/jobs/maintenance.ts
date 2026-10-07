import { DataSource, withTransaction } from '@moodboard/database';
import { Storage } from '@moodboard/storage';
import { MediaJob } from '@moodboard/contracts';
import { MaintenanceRepository } from './maintenance.repository';
import { MediaProcessors } from './processors';
import { MediaQueues, QueueName, jobId, generation, deadline } from '../queues/media';
export function maintenanceDay(now: Date): string | null {
  return now.getUTCHours() >= 2 ? now.toISOString().slice(0, 10) : null;
}
export class Maintenance {
  private readonly repository = new MaintenanceRepository();
  constructor(
    readonly source: DataSource,
    readonly storage: Storage,
    readonly queues: MediaQueues,
    readonly processors: MediaProcessors,
  ) {}
  async ensure(name: QueueName, payload: MediaJob) {
    const queue = this.queues.queues[name];
    const existing = await deadline(queue.getJob(jobId(payload)), 2000);
    if (!existing) {
      await deadline(this.queues.add(name, payload), 2000);
      return;
    }
    if ((await existing.getState()) === 'failed') {
      await this.processors.fail(name, payload);
    }
  }
  async reconcile() {
    const assets = await this.repository.pendingAssets(this.source.manager);
    for (const asset of assets) {
      await this.ensure('process-image', { entityId: asset.id, generation: 'initial' });
    }
    const previews = await this.repository.referencedPreviews(this.source.manager, false);
    for (const preview of previews) {
      await this.ensure('fetch-preview', { entityId: preview.id, generation: generation(preview) });
    }
    // Exhausted refresh jobs can leave a ready/failed row with its previous expiry.
    const expired = await this.repository.referencedPreviews(this.source.manager, true);
    for (const preview of expired) {
      const payload = { entityId: preview.id, generation: generation(preview) };
      const existing = await deadline(
        this.queues.queues['fetch-preview'].getJob(jobId(payload)),
        2000,
      );
      if (existing && (await existing.getState()) === 'failed') {
        await this.processors.fail('fetch-preview', payload);
      }
    }
  }
  async refresh() {
    const previews = await this.repository.referencedPreviews(this.source.manager, true);
    for (const preview of previews) {
      await this.ensure('fetch-preview', { entityId: preview.id, generation: generation(preview) });
    }
  }
  async cleanup(now = new Date()) {
    const before = new Date(now.getTime() - 86400_000);
    const assets = await this.repository.orphanAssets(this.source.manager, before);
    let removed = 0;
    for (const asset of assets) {
      removed += await withTransaction(this.source, (manager) =>
        this.repository.removeOrphan(manager, asset.id, asset.boardId, before),
      );
    }
    let objects = 0;
    for await (const object of this.storage.objects()) {
      if (object.modifiedAt >= before) {
        continue;
      }
      if (!(await this.repository.hasObjectReferences(this.source.manager, object.key))) {
        await this.storage.delete(object.key);
        objects++;
      }
    }
    console.info(JSON.stringify({ operation: 'storage-cleanup', assets: removed, objects }));
  }
  async prune(now = new Date()) {
    const before = new Date(now.getTime() - 30 * 86400_000);
    let count = 0;
    for (;;) {
      const removed = await this.repository.pruneBatch(this.source.manager, before);
      count += removed;
      if (removed < 10000) {
        break;
      }
    }
    console.info(JSON.stringify({ operation: 'event-prune', events: count }));
  }
  async daily(now = new Date()) {
    await this.repository.purgeContactSessions(this.source.manager, now);
    await this.refresh();
    await this.cleanup(now);
    await this.prune(now);
  }
}
