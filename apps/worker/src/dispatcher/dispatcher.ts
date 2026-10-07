import { DataSource, withTransaction } from '@moodboard/database';
import { MediaJob } from '@moodboard/contracts';
import { MediaQueues, deadline, generation, jobId } from '../queues/media';
import { Delivery, DispatcherRepository } from './dispatcher.repository';
export type { Delivery } from './dispatcher.repository';

export class Dispatcher {
  private readonly repository = new DispatcherRepository();
  constructor(
    readonly source: DataSource,
    readonly queues: MediaQueues,
  ) {}
  async fanout() {
    return withTransaction(this.source, async (manager) => {
      const events = await this.repository.unfanned(manager);
      for (const event of events) {
        const target =
          event.type === 'item.created'
            ? event.payload.kind === 'image'
              ? 'process-image'
              : event.payload.kind === 'link'
                ? 'fetch-preview'
                : null
            : null;
        if (target) {
          await this.repository.addDelivery(manager, event.id, target);
        }
        await this.repository.markFanned(manager, event.id, Boolean(target));
      }
      return events.length;
    });
  }
  async claim(): Promise<Delivery[]> {
    return withTransaction(this.source, (manager) => this.repository.claim(manager));
  }
  async payload(delivery: Delivery): Promise<MediaJob | null> {
    const event = await this.repository.event(this.source.manager, delivery.eventId);
    if (!event) {
      return null;
    }
    const itemId = event.payload.itemId as string;
    if (delivery.target === 'process-image') {
      const asset = await this.repository.itemAsset(this.source.manager, itemId);
      return asset?.status === 'pending' ? { entityId: asset.id, generation: 'initial' } : null;
    }
    const preview = await this.repository.itemPreview(this.source.manager, itemId);
    if (!preview || (preview.expiresAt && preview.expiresAt.getTime() > Date.now())) {
      return null;
    }
    return { entityId: preview.id, generation: generation(preview) };
  }
  async acknowledge(delivery: Delivery, success: boolean) {
    await this.repository.acknowledge(this.source.manager, delivery, success);
  }
  async finalize() {
    await this.repository.finalize(this.source.manager);
  }
  async tick() {
    await this.fanout();
    const deliveries = await this.claim();
    // Keep every lease within its deadline, even at the full batch size.
    await Promise.all(
      deliveries.map(async (delivery) => {
        let queuedJobId: string | null = null;
        try {
          const payload = await this.payload(delivery);
          if (payload) {
            queuedJobId = jobId(payload);
            await deadline(this.queues.add(delivery.target, payload), 2000);
          }
          await this.acknowledge(delivery, true);
          console.info(
            JSON.stringify({
              operation: 'delivery',
              eventId: delivery.eventId,
              jobId: queuedJobId,
              attempt: delivery.attempts,
              outcome: 'confirmed',
            }),
          );
        } catch {
          await this.acknowledge(delivery, false);
          console.error(
            JSON.stringify({
              operation: 'delivery',
              eventId: delivery.eventId,
              jobId: queuedJobId,
              attempt: delivery.attempts,
              outcome: 'retry',
            }),
          );
        }
      }),
    );
    await this.finalize();
    const age = await this.repository.backlogAge(this.source.manager);
    if (deliveries.length || (age ?? 0) > 60) {
      console.info(
        JSON.stringify({
          operation: 'dispatch',
          deliveries: deliveries.length,
          backlogAgeSeconds: age,
        }),
      );
    }
  }
}
