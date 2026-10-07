import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApprovalStatus } from '@moodboard/contracts';
import {
  ApprovalStateEntity,
  ApprovalDecisionEntity,
  BoardParticipantEntity,
  ClientContactEntity,
  ItemEntity,
  entityFromRow,
} from '@moodboard/database';

export type ApprovalStateRow = Pick<
  ApprovalStateEntity,
  'itemId' | 'itemVersion' | 'status' | 'coreState'
>;
export type ApprovalReconciliationRow = ApprovalStateRow & { nextStatus: ApprovalStatus };
export type DecisionRecord = ApprovalDecisionEntity;
export type DecisionWithContactRow = DecisionRecord & { contactId: string; contactName: string };
type DecisionProjection = Record<string, unknown> & { contactId: string; contactName: string };
function decisionWithContact(
  manager: EntityManager,
  row: DecisionProjection,
): DecisionWithContactRow {
  return {
    ...entityFromRow(manager, ApprovalDecisionEntity, row),
    contactId: row.contactId,
    contactName: row.contactName,
  };
}
function decisionsWithContact(manager: EntityManager) {
  return manager
    .createQueryBuilder(ApprovalDecisionEntity, 'decision')
    .select('decision.*')
    .addSelect('participant.contactId', 'contactId')
    .addSelect('contact.name', 'contactName')
    .innerJoin(BoardParticipantEntity, 'participant', 'participant.id = decision.participantId')
    .innerJoin(ClientContactEntity, 'contact', 'contact.id = participant.contactId');
}
@Injectable()
export class ApprovalsRepository {
  states(manager: EntityManager, boardId: string): Promise<ApprovalStateRow[]> {
    return manager
      .createQueryBuilder(ApprovalStateEntity, 'state')
      .innerJoin(ItemEntity, 'item', 'item.id = state.itemId')
      .where('item.boardId = :boardId AND item.deletedAt IS NULL', { boardId })
      .getMany();
  }
  reconciliationCandidates(
    manager: EntityManager,
    boardId: string,
  ): Promise<ApprovalReconciliationRow[]> {
    return manager.sql<ApprovalReconciliationRow[]>`
      WITH active_approvers as (
        select p.id from board_participants p
        join boards b on b.id=p.board_id
        join client_contacts c on c.id=p.contact_id and c.client_id=b.client_id and c.removed_at is null
        where p.board_id=${boardId} and p.role='approver' and p.revoked_at is null
          and (p.expires_at is null or p.expires_at>clock_timestamp())
      )
      select s.item_id as "itemId",s.item_version as "itemVersion",s.status,s.core_state as "coreState",
        case
          when bool_or(d.status='swap_requested') then 'swap_requested'
          when bool_or(d.status='rejected') then 'rejected'
          when count(p.id)>0 and count(d.status)=count(p.id)
            and bool_and(d.status='approved') then 'approved'
          else 'pending'
        end as "nextStatus"
      from approval_states s
      join items i on i.id=s.item_id and i.board_id=${boardId} and i.deleted_at is null
      left join active_approvers p on true
      left join lateral (
        select status from approval_decisions
        where item_id=s.item_id and item_version=s.item_version and participant_id=p.id
        order by decided_at desc,id desc limit 1
      ) d on true
      where s.core_state<>'approved'
      group by s.item_id,s.item_version,s.status,s.core_state
      order by s.item_id
    `;
  }

  async state(manager: EntityManager, itemId: string, version: number): Promise<ApprovalStateRow> {
    // Reset only when content advances, preserving completed sign-off on retries.
    const [row] = await manager.sql<Record<string, unknown>[]>`
      INSERT INTO approval_states(item_id, item_version, status, core_state)
      VALUES (${itemId}, ${version}, 'pending', 'pending')
      ON CONFLICT(item_id) DO UPDATE
      SET item_version = excluded.item_version, status = 'pending', core_state = 'pending', updated_at = now()
      WHERE approval_states.item_version <> excluded.item_version
      RETURNING *
    `;
    if (row) {
      return entityFromRow(manager, ApprovalStateEntity, row);
    }
    return (await this.lockState(manager, itemId))!;
  }
  lockState(manager: EntityManager, itemId: string) {
    return manager
      .createQueryBuilder(ApprovalStateEntity, 'state')
      .where('state.itemId = :itemId', { itemId })
      .setLock('pessimistic_write')
      .getOne();
  }
  async updateState(manager: EntityManager, state: ApprovalStateRow) {
    await manager
      .createQueryBuilder()
      .update(ApprovalStateEntity)
      .set({
        itemVersion: state.itemVersion,
        status: state.status,
        coreState: state.coreState,
        updatedAt: () => 'now()',
      })
      .where('item_id = :itemId', { itemId: state.itemId })
      .execute();
  }
  async existingDecision(
    manager: EntityManager,
    id: string,
  ): Promise<DecisionWithContactRow | null> {
    const row = await decisionsWithContact(manager)
      .where('decision.id = :id', { id })
      .getRawOne<DecisionProjection>();
    return row ? decisionWithContact(manager, row) : null;
  }
  async currentDecisions(
    manager: EntityManager,
    boardId: string,
    itemId: string,
    version: number,
  ): Promise<{ status: DecisionRecord['status'] | null }[]> {
    return manager.sql<{ status: DecisionRecord['status'] | null }[]>`
      SELECT d.status from board_participants p
      join boards b on b.id=p.board_id
      join client_contacts c on c.id=p.contact_id and c.client_id=b.client_id and c.removed_at is null
      left join lateral (
        select status from approval_decisions where item_id=${itemId} and item_version=${version}
          and participant_id=p.id order by decided_at desc,id desc limit 1
      ) d on true
      where p.board_id=${boardId} and p.role='approver' and p.revoked_at is null
        and (p.expires_at is null or p.expires_at>clock_timestamp())
    `;
  }

  async latestDecisions(
    manager: EntityManager,
    boardId: string,
  ): Promise<DecisionWithContactRow[]> {
    const rows = await decisionsWithContact(manager)
      .innerJoin(
        ItemEntity,
        'item',
        'item.id = decision.itemId AND item.version = decision.itemVersion',
      )
      .distinctOn(['decision.itemId', 'decision.participantId'])
      .where('item.boardId = :boardId AND item.deletedAt IS NULL', { boardId })
      .orderBy('decision.itemId')
      .addOrderBy('decision.participantId')
      .addOrderBy('decision.decidedAt', 'DESC')
      .addOrderBy('decision.id', 'DESC')
      .getRawMany<DecisionProjection>();
    return rows.map((row) => decisionWithContact(manager, row));
  }
  itemVersions(
    manager: EntityManager,
    boardId: string,
  ): Promise<Pick<ItemEntity, 'id' | 'version'>[]> {
    return manager
      .createQueryBuilder(ItemEntity, 'item')
      .select(['item.id', 'item.version'])
      .where('item.boardId = :boardId AND item.deletedAt IS NULL', { boardId })
      .orderBy('item.zOrder COLLATE "C"')
      .addOrderBy('item.id')
      .getMany();
  }
  itemVersion(
    manager: EntityManager,
    boardId: string,
    itemId: string,
  ): Promise<Pick<ItemEntity, 'version'> | null> {
    return manager
      .createQueryBuilder(ItemEntity, 'item')
      .select(['item.id', 'item.version'])
      .where('item.boardId = :boardId AND item.id = :itemId AND item.deletedAt IS NULL', {
        boardId,
        itemId,
      })
      .getOne();
  }
  async insertDecision(
    manager: EntityManager,
    input: Pick<
      DecisionRecord,
      'id' | 'itemId' | 'itemVersion' | 'participantId' | 'status' | 'comment'
    >,
  ): Promise<DecisionRecord> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ApprovalDecisionEntity)
      .values(input)
      .returning('*')
      .execute();
    return entityFromRow(manager, ApprovalDecisionEntity, result.raw[0]);
  }
  async updateDecisionResult(manager: EntityManager, id: string, next: ApprovalStateRow) {
    await manager
      .createQueryBuilder()
      .update(ApprovalDecisionEntity)
      .set({ resultStatus: next.status, resultCoreState: next.coreState })
      .where('id = :id', { id })
      .execute();
  }
}
