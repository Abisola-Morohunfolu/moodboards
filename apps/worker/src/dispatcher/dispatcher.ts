import { randomUUID } from 'node:crypto';
import { DataSource, withTransaction } from '@moodboard/database';
import { MediaJob } from '@moodboard/contracts';
import { MediaQueues, QueueName, deadline, backoff, generation, jobId } from '../queues/media';
interface Event {
  id: string;
  type: string;
  payload: { kind?: string };
}
export interface Delivery {
  event_id: string;
  target: QueueName;
  attempts: number;
  lease_token: string;
}
export class Dispatcher {
  constructor(
    readonly source: DataSource,
    readonly queues: MediaQueues,
  ) {}
  async fanout() {
    return withTransaction(this.source, async (manager) => {
      const events: Event[] = await manager.query(
        'select id,type,payload from board_events where fanned_out_at is null order by id limit 100 for update skip locked',
      );
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
          await manager.query(
            'insert into board_event_deliveries (event_id,target) values ($1,$2) on conflict do nothing',
            [event.id, target],
          );
        }
        await manager.query(
          'update board_events set fanned_out_at=now(),dispatched_at=case when $2::boolean then null else now() end where id=$1',
          [event.id, Boolean(target)],
        );
      }
      return events.length;
    });
  }
  async claim(): Promise<Delivery[]> {
    return withTransaction(this.source, async (manager) => {
      // A crash on attempt ten must finish rather than leave an unclaimable delivery.
      await manager.query(
        "update board_event_deliveries set failed_at=now(),last_error='Delivery lease expired',lease_token=null,lease_until=null where done_at is null and failed_at is null and attempts>=10 and (lease_until is null or lease_until<=now())",
      );
      const rows: Delivery[] = await manager.query(
        `with due as (
        select event_id,target from board_event_deliveries where done_at is null and failed_at is null and attempts<10 and next_attempt_at<=now() and (lease_until is null or lease_until<=now()) order by next_attempt_at,event_id limit 100 for update skip locked
      ), claimed as (update board_event_deliveries d set attempts=d.attempts+1,lease_token=$1,lease_until=now()+interval '30 seconds' from due where d.event_id=due.event_id and d.target=due.target returning d.*) select * from claimed`,
        [randomUUID()],
      );
      return rows;
    });
  }
  async payload(delivery: Delivery): Promise<MediaJob | null> {
    const [event]: { payload: { itemId: string } }[] = await this.source.query(
      'select payload from board_events where id=$1',
      [delivery.event_id],
    );
    if (!event) {
      return null;
    }
    if (delivery.target === 'process-image') {
      const [asset]: { id: string; status: string }[] = await this.source.query(
        'select a.id,a.status from items i join assets a on a.id=i.asset_id where i.id=$1 and i.deleted_at is null',
        [event.payload.itemId],
      );
      return asset?.status === 'pending' ? { entityId: asset.id, generation: 'initial' } : null;
    }
    const [preview]: { id: string; status: string; expires_at: Date | null }[] =
      await this.source.query(
        'select p.id,p.status,p.expires_at from items i join link_previews p on p.id=i.link_preview_id where i.id=$1 and i.deleted_at is null',
        [event.payload.itemId],
      );
    if (!preview || (preview.expires_at && preview.expires_at.getTime() > Date.now())) {
      return null;
    }
    return { entityId: preview.id, generation: generation(preview) };
  }
  async acknowledge(delivery: Delivery, success: boolean) {
    await this.source.query(
      `update board_event_deliveries set lease_token=null,lease_until=null,
      done_at=case when $4 then now() else null end,
      failed_at=case when not $4 and attempts>=10 then now() else null end,
      next_attempt_at=now()+$5::int*interval '1 millisecond',last_error=case when $4 then null else 'Queue delivery unavailable' end
      where event_id=$1 and target=$2 and lease_token=$3 and lease_until>now()`,
      [
        delivery.event_id,
        delivery.target,
        delivery.lease_token,
        success,
        backoff(delivery.attempts),
      ],
    );
  }
  async finalize() {
    await this.source.query(
      `update board_events e set dispatched_at=now() where e.fanned_out_at is not null and e.dispatched_at is null and not exists (select 1 from board_event_deliveries d where d.event_id=e.id and d.done_at is null and d.failed_at is null)`,
    );
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
              eventId: delivery.event_id,
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
              eventId: delivery.event_id,
              jobId: queuedJobId,
              attempt: delivery.attempts,
              outcome: 'retry',
            }),
          );
        }
      }),
    );
    await this.finalize();
    const [backlog]: { age: number | null }[] = await this.source.query(
      'select extract(epoch from now()-min(created_at))::float8 as age from board_events where dispatched_at is null',
    );
    if (deliveries.length || (backlog?.age ?? 0) > 60) {
      console.info(
        JSON.stringify({
          operation: 'dispatch',
          deliveries: deliveries.length,
          backlogAgeSeconds: backlog?.age ?? 0,
        }),
      );
    }
  }
}
