import { DataSource, withTransaction } from '@moodboard/database';
import { Storage } from '@moodboard/storage';
import { MediaJob } from '@moodboard/contracts';
import { MediaProcessors } from './processors';
import { MediaQueues, QueueName, jobId, generation, deadline } from '../queues/media';
export function maintenanceDay(now: Date): string | null {
  return now.getUTCHours() >= 2 ? now.toISOString().slice(0, 10) : null;
}
export class Maintenance {
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
    const assets: { id: string }[] = await this.source.query(
      "select id from assets a where status='pending' and exists (select 1 from items i where i.asset_id=a.id and i.deleted_at is null)",
    );
    for (const asset of assets) {
      await this.ensure('process-image', { entityId: asset.id, generation: 'initial' });
    }
    const previews: { id: string; expires_at: Date | null }[] = await this.source.query(
      "select id,expires_at from link_previews p where status='pending' and exists (select 1 from items i where i.link_preview_id=p.id and i.deleted_at is null)",
    );
    for (const preview of previews) {
      await this.ensure('fetch-preview', { entityId: preview.id, generation: generation(preview) });
    }
    // Exhausted refresh jobs can leave a ready/failed row with its previous expiry.
    const expired: { id: string; expires_at: Date | null }[] = await this.source.query(
      'select id,expires_at from link_previews p where expires_at<=now() and exists (select 1 from items i where i.link_preview_id=p.id and i.deleted_at is null)',
    );
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
    const previews: { id: string; expires_at: Date | null }[] = await this.source.query(
      'select id,expires_at from link_previews p where expires_at<=now() and exists (select 1 from items i where i.link_preview_id=p.id and i.deleted_at is null)',
    );
    for (const preview of previews) {
      await this.ensure('fetch-preview', { entityId: preview.id, generation: generation(preview) });
    }
  }
  async cleanup(now = new Date()) {
    const before = new Date(now.getTime() - 86400_000);
    const assets: { id: string; board_id: string }[] = await this.source.query(
      'select id,board_id from assets a where created_at<$1 and not exists (select 1 from items i where i.asset_id=a.id) order by board_id,id',
      [before],
    );
    let removed = 0;
    for (const asset of assets) {
      removed += await withTransaction(this.source, async (manager) => {
        await manager.query('select id from boards where id=$1 for update', [asset.board_id]);
        const rows: unknown[] = await manager.query(
          'with removed as (delete from assets a where id=$1 and created_at<$2 and not exists (select 1 from items i where i.asset_id=a.id) returning id) select id from removed',
          [asset.id, before],
        );
        return rows.length;
      });
    }
    let objects = 0;
    for await (const object of this.storage.objects()) {
      if (object.modifiedAt >= before) {
        continue;
      }
      const refs: unknown[] = await this.source.query(
        'select 1 from assets where storage_key=$1 or thumbnail_key=$1 limit 1',
        [object.key],
      );
      if (!refs.length) {
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
      const rows: unknown[] = await this.source.query(
        'with old as (select id from board_events where dispatched_at<$1 order by id limit 10000), removed as (delete from board_events e using old where e.id=old.id returning e.id) select id from removed',
        [before],
      );
      count += rows.length;
      if (rows.length < 10000) {
        break;
      }
    }
    console.info(JSON.stringify({ operation: 'event-prune', events: count }));
  }
  async daily(now = new Date()) {
    await this.refresh();
    await this.cleanup(now);
    await this.prune(now);
  }
}
