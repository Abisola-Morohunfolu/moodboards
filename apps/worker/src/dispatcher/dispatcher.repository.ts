import { randomUUID } from 'node:crypto';
import {
  BoardEventEntity,
  BoardEventDeliveryEntity,
  AssetEntity,
  ItemEntity,
  LinkPreviewEntity,
  EntityManager,
  entityFromRow,
} from '@moodboard/database';
import { QueueName, backoff } from '../queues/media';

export type Delivery = Pick<BoardEventDeliveryEntity, 'eventId' | 'attempts'> & {
  target: QueueName;
  leaseToken: string;
};
export class DispatcherRepository {
  unfanned(manager: EntityManager) {
    return manager
      .createQueryBuilder(BoardEventEntity, 'event')
      .select(['event.id', 'event.type', 'event.payload'])
      .where('event.fannedOutAt IS NULL')
      .orderBy('event.id')
      .limit(100)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
  }
  async addDelivery(manager: EntityManager, eventId: string, target: QueueName) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(BoardEventDeliveryEntity)
      .values({ eventId, target })
      .orIgnore()
      .execute();
  }
  async markFanned(manager: EntityManager, id: string, hasTarget: boolean) {
    await manager
      .createQueryBuilder()
      .update(BoardEventEntity)
      .set({ fannedOutAt: () => 'now()', dispatchedAt: hasTarget ? null : () => 'now()' })
      .where('id = :id', { id })
      .execute();
  }
  async claim(manager: EntityManager): Promise<Delivery[]> {
    await manager
      .createQueryBuilder()
      .update(BoardEventDeliveryEntity)
      .set({
        failedAt: () => 'now()',
        lastError: 'Delivery lease expired',
        leaseToken: null,
        leaseUntil: null,
      })
      .where(
        'done_at IS NULL AND failed_at IS NULL AND attempts >= 10 AND (lease_until IS NULL OR lease_until <= now())',
      )
      .execute();
    // One statement claims and advances leases under SKIP LOCKED. Splitting the
    // selection and update would change the delivery protocol.
    const rows = await manager.sql<Record<string, unknown>[]>`
      WITH due AS (
        SELECT event_id, target FROM board_event_deliveries
        WHERE done_at IS NULL AND failed_at IS NULL AND attempts < 10
          AND next_attempt_at <= now() AND (lease_until IS NULL OR lease_until <= now())
        ORDER BY next_attempt_at, event_id LIMIT 100 FOR UPDATE SKIP LOCKED
      ), claimed AS (
        UPDATE board_event_deliveries d SET attempts = d.attempts + 1,
          lease_token = ${randomUUID()}, lease_until = now() + interval '30 seconds'
        FROM due WHERE d.event_id = due.event_id AND d.target = due.target RETURNING d.*
      ) SELECT * FROM claimed
    `;
    return rows.map((row) => entityFromRow(manager, BoardEventDeliveryEntity, row) as Delivery);
  }
  event(manager: EntityManager, eventId: string) {
    return manager
      .createQueryBuilder(BoardEventEntity, 'event')
      .select(['event.id', 'event.payload'])
      .where('event.id = :eventId', { eventId })
      .getOne();
  }
  itemAsset(manager: EntityManager, itemId: string) {
    return manager
      .createQueryBuilder(AssetEntity, 'asset')
      .select(['asset.id', 'asset.status'])
      .innerJoin(ItemEntity, 'item', 'item.assetId = asset.id')
      .where('item.id = :itemId AND item.deletedAt IS NULL', { itemId })
      .getOne();
  }
  itemPreview(manager: EntityManager, itemId: string) {
    return manager
      .createQueryBuilder(LinkPreviewEntity, 'preview')
      .select(['preview.id', 'preview.status', 'preview.expiresAt'])
      .innerJoin(ItemEntity, 'item', 'item.linkPreviewId = preview.id')
      .where('item.id = :itemId AND item.deletedAt IS NULL', { itemId })
      .getOne();
  }
  async acknowledge(manager: EntityManager, delivery: Delivery, success: boolean) {
    await manager
      .createQueryBuilder()
      .update(BoardEventDeliveryEntity)
      .set({
        leaseToken: null,
        leaseUntil: null,
        doneAt: success ? () => 'now()' : null,
        failedAt: success ? null : () => 'CASE WHEN attempts >= 10 THEN now() ELSE NULL END',
        nextAttemptAt: () => "now() + :delayMs::int * interval '1 millisecond'",
        lastError: success ? null : 'Queue delivery unavailable',
      })
      .where(
        'event_id = :eventId AND target = :target AND lease_token = :leaseToken AND lease_until > now()',
        delivery,
      )
      .setParameter('delayMs', backoff(delivery.attempts))
      .execute();
  }
  async finalize(manager: EntityManager) {
    const pending = manager
      .createQueryBuilder(BoardEventDeliveryEntity, 'delivery')
      .select('1')
      .where(
        'delivery.eventId = board_events.id AND delivery.doneAt IS NULL AND delivery.failedAt IS NULL',
      );
    await manager
      .createQueryBuilder()
      .update(BoardEventEntity)
      .set({ dispatchedAt: () => 'now()' })
      .where(
        `fanned_out_at IS NOT NULL AND dispatched_at IS NULL AND NOT EXISTS (${pending.getQuery()})`,
      )
      .execute();
  }
  async backlogAge(manager: EntityManager): Promise<number | null> {
    const row = await manager
      .createQueryBuilder(BoardEventEntity, 'event')
      .select('extract(epoch FROM now() - min(event.createdAt))::float8', 'age')
      .where('event.dispatchedAt IS NULL')
      .getRawOne<{ age: number | null }>();
    return row?.age ?? null;
  }
}
