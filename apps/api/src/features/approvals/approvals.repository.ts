import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApprovalStatus } from '@moodboard/contracts';

export interface ApprovalStateRow {
  item_id: string;
  item_version: number;
  status: ApprovalStatus;
  core_state: 'pending' | 'approved' | 'rejected';
}
export interface ApprovalReconciliationRow extends ApprovalStateRow {
  next_status: ApprovalStatus;
}
export interface DecisionRow {
  id: string;
  item_id: string;
  item_version: number;
  participant_id: string;
  contact_id: string;
  contact_name: string;
  status: 'approved' | 'rejected' | 'swap_requested';
  comment: string | null;
  decided_at: Date;
  result_status: ApprovalStatus | null;
  result_core_state: 'pending' | 'approved' | 'rejected' | null;
}

@Injectable()
export class ApprovalsRepository {
  states(manager: EntityManager, boardId: string): Promise<ApprovalStateRow[]> {
    return manager.query(
      `select s.item_id,s.item_version,s.status,s.core_state from approval_states s
      join items i on i.id=s.item_id where i.board_id=$1 and i.deleted_at is null`,
      [boardId],
    );
  }

  reconciliationCandidates(
    manager: EntityManager,
    boardId: string,
  ): Promise<ApprovalReconciliationRow[]> {
    return manager.query(
      `with active_approvers as (
        select p.id from board_participants p
        join boards b on b.id=p.board_id
        join client_contacts c on c.id=p.contact_id and c.client_id=b.client_id and c.removed_at is null
        where p.board_id=$1 and p.role='approver' and p.revoked_at is null
          and (p.expires_at is null or p.expires_at>clock_timestamp())
      )
      select s.item_id,s.item_version,s.status,s.core_state,
        case
          when bool_or(d.status='swap_requested') then 'swap_requested'
          when bool_or(d.status='rejected') then 'rejected'
          when count(p.id)>0 and count(d.status)=count(p.id)
            and bool_and(d.status='approved') then 'approved'
          else 'pending'
        end as next_status
      from approval_states s
      join items i on i.id=s.item_id and i.board_id=$1 and i.deleted_at is null
      left join active_approvers p on true
      left join lateral (
        select status from approval_decisions
        where item_id=s.item_id and item_version=s.item_version and participant_id=p.id
        order by decided_at desc,id desc limit 1
      ) d on true
      where s.core_state<>'approved'
      group by s.item_id,s.item_version,s.status,s.core_state
      order by s.item_id`,
      [boardId],
    );
  }

  async state(manager: EntityManager, itemId: string, version: number): Promise<ApprovalStateRow> {
    const [row] = await manager.query<ApprovalStateRow[]>(
      `insert into approval_states(item_id,item_version,status,core_state)
      values($1,$2,'pending','pending') on conflict(item_id) do update
      set item_version=excluded.item_version,status='pending',core_state='pending',updated_at=now()
      where approval_states.item_version<>excluded.item_version
      returning item_id,item_version,status,core_state`,
      [itemId, version],
    );
    if (row) {
      return row;
    }
    const [existing] = await manager.query<ApprovalStateRow[]>(
      'select item_id,item_version,status,core_state from approval_states where item_id=$1 for update',
      [itemId],
    );
    return existing!;
  }

  async existingDecision(manager: EntityManager, id: string): Promise<DecisionRow | null> {
    const [row] = await manager.query<DecisionRow[]>(
      `select d.*,p.contact_id,c.name as contact_name from approval_decisions d
      join board_participants p on p.id=d.participant_id
      join client_contacts c on c.id=p.contact_id where d.id=$1`,
      [id],
    );
    return row ?? null;
  }

  async currentDecisions(
    manager: EntityManager,
    boardId: string,
    itemId: string,
    version: number,
  ): Promise<{ status: DecisionRow['status'] | null }[]> {
    return manager.query(
      `select d.status from board_participants p
      join boards b on b.id=p.board_id
      join client_contacts c on c.id=p.contact_id and c.client_id=b.client_id and c.removed_at is null
      left join lateral (
        select status from approval_decisions where item_id=$2 and item_version=$3
          and participant_id=p.id order by decided_at desc,id desc limit 1
      ) d on true
      where p.board_id=$1 and p.role='approver' and p.revoked_at is null
        and (p.expires_at is null or p.expires_at>clock_timestamp())`,
      [boardId, itemId, version],
    );
  }

  latestDecisions(manager: EntityManager, boardId: string): Promise<DecisionRow[]> {
    return manager.query(
      `select distinct on (d.item_id,d.participant_id)
        d.*,p.contact_id,c.name as contact_name
      from approval_decisions d
      join items i on i.id=d.item_id and i.version=d.item_version
      join board_participants p on p.id=d.participant_id
      join client_contacts c on c.id=p.contact_id
      where i.board_id=$1 and i.deleted_at is null
      order by d.item_id,d.participant_id,d.decided_at desc,d.id desc`,
      [boardId],
    );
  }
}
