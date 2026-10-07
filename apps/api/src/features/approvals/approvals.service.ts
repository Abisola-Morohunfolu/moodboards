import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientApproval, DecisionRequest, PlannerApproval } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';
import { AccessService } from '../access/access.service';
import { BoardAccess } from '../access/access.repository';
import { ContactPrincipal } from '../access/contact-access';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { ApprovalStateRow, ApprovalsRepository, DecisionRow } from './approvals.repository';

function coreState(status: ApprovalStateRow['status']): ApprovalStateRow['core_state'] {
  return status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'rejected';
}

function decisionResponse(row: DecisionRow) {
  return {
    id: row.id,
    itemId: row.item_id,
    itemVersion: row.item_version,
    status: row.status,
    comment: row.comment,
    decidedAt: row.decided_at.toISOString(),
  };
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: ApprovalsRepository,
    private readonly events: BoardEventWriter,
  ) {}

  private assertAvailable(access: BoardAccess): void {
    if (access.board.workspace_type !== 'business' || access.board.client_id === null) {
      throw new NotFoundException('Approvals not available');
    }
  }

  private async calculate(
    manager: EntityManager,
    boardId: string,
    itemId: string,
    version: number,
  ): Promise<ApprovalStateRow['status']> {
    const decisions = await this.repository.currentDecisions(manager, boardId, itemId, version);
    if (decisions.some((d) => d.status === 'swap_requested')) {
      return 'swap_requested';
    }
    if (decisions.some((d) => d.status === 'rejected')) {
      return 'rejected';
    }
    if (decisions.length && decisions.every((d) => d.status === 'approved')) {
      return 'approved';
    }
    return 'pending';
  }

  private async applyState(
    manager: EntityManager,
    boardId: string,
    state: ApprovalStateRow,
    status: ApprovalStateRow['status'],
    actorId: string | null,
  ): Promise<ApprovalStateRow> {
    if (state.status === status) {
      return state;
    }
    const next = { ...state, status, core_state: coreState(status) };
    await manager.query(
      'update approval_states set status=$2,core_state=$3,updated_at=now() where item_id=$1',
      [state.item_id, next.status, next.core_state],
    );
    if (state.core_state !== next.core_state) {
      await this.events.append(manager, boardId, actorId, {
        type: 'approval.state_changed',
        payload: {
          itemId: state.item_id,
          itemVersion: state.item_version,
          coreState: next.core_state,
        },
      });
    }
    return next;
  }

  // Callers hold the board lock. Approved item versions are deliberately frozen.
  async reconcileBoard(manager: EntityManager, boardId: string, actorId: string | null) {
    const candidates = await this.repository.reconciliationCandidates(manager, boardId);
    for (const { next_status, ...state } of candidates) {
      if (state.status !== next_status) {
        await this.applyState(manager, boardId, state, next_status, actorId);
      }
    }
  }

  async resetItem(
    manager: EntityManager,
    boardId: string,
    itemId: string,
    version: number,
    actorId: string | null,
  ) {
    const [previous] = await manager.query<ApprovalStateRow[]>(
      'select item_id,item_version,status,core_state from approval_states where item_id=$1 for update',
      [itemId],
    );
    if (!previous) {
      return;
    }
    await manager.query(
      "update approval_states set item_version=$2,status='pending',core_state='pending',updated_at=now() where item_id=$1",
      [itemId, version],
    );
    if (previous.core_state !== 'pending') {
      await this.events.append(manager, boardId, actorId, {
        type: 'approval.state_changed',
        payload: { itemId, itemVersion: version, coreState: 'pending' },
      });
    }
  }

  private async read(
    manager: EntityManager,
    boardId: string,
    actorId: string | null,
    contactId?: string,
  ): Promise<PlannerApproval[] | ClientApproval[]> {
    await this.reconcileBoard(manager, boardId, actorId);
    const items: { id: string; version: number }[] = await manager.query(
      'select id,version from items where board_id=$1 and deleted_at is null order by z_order collate "C",id',
      [boardId],
    );
    const states = new Map(
      (await this.repository.states(manager, boardId)).map((s) => [s.item_id, s]),
    );
    const decisions = await this.repository.latestDecisions(manager, boardId);
    return items.map((item) => {
      const state = states.get(item.id);
      const base = {
        itemId: item.id,
        itemVersion: item.version,
        status: state?.status ?? 'pending',
        coreState: state?.core_state ?? 'pending',
      } as const;
      const itemDecisions = decisions.filter((d) => d.item_id === item.id);
      if (contactId) {
        const own = itemDecisions.find((d) => d.participant_id === contactId);
        return { ...base, ownDecision: own ? decisionResponse(own) : null };
      }
      return {
        ...base,
        decisions: itemDecisions.map((d) => ({
          ...decisionResponse(d),
          participantId: d.participant_id,
          contactId: d.contact_id,
          contactName: d.contact_name,
        })),
      };
    }) as PlannerApproval[] | ClientApproval[];
  }

  plannerList(userId: string, boardId: string): Promise<PlannerApproval[]> {
    return this.access.withBoard(userId, boardId, 'item.edit', async (manager, access) => {
      this.assertAvailable(access);
      return (await this.read(manager, boardId, access.participantId)) as PlannerApproval[];
    });
  }

  clientList(contact: ContactPrincipal): Promise<ClientApproval[]> {
    return this.access.withBoard(
      contact,
      contact.boardId,
      'board.view',
      async (manager, access) => {
        this.assertAvailable(access);
        return (await this.read(
          manager,
          contact.boardId,
          access.participantId,
          contact.participantId,
        )) as ClientApproval[];
      },
      false,
    );
  }

  decide(contact: ContactPrincipal, input: DecisionRequest) {
    return this.access.withBoard(
      contact,
      contact.boardId,
      'board.view',
      async (manager, access) => {
        this.assertAvailable(access);
        if (access.role !== 'approver' || access.board.participant_role !== 'approver') {
          throw new ForbiddenException('Approver assignment required');
        }
        const old = await this.repository.existingDecision(manager, input.id);
        if (old) {
          if (
            old.participant_id !== contact.participantId ||
            old.item_id !== input.itemId ||
            old.item_version !== input.itemVersion ||
            old.status !== input.status ||
            old.comment !== (input.comment ?? null)
          ) {
            throw new ConflictException('Decision id already in use');
          }
          return {
            created: false,
            body: {
              approval: {
                itemId: old.item_id,
                itemVersion: old.item_version,
                status: old.result_status!,
                coreState: old.result_core_state!,
                ownDecision: decisionResponse(old),
              },
              decision: decisionResponse(old),
            },
          };
        }
        const [item] = await manager.query<{ version: number }[]>(
          'select version from items where board_id=$1 and id=$2 and deleted_at is null',
          [contact.boardId, input.itemId],
        );
        if (!item) {
          throw new NotFoundException('Item not found');
        }
        if (item.version !== input.itemVersion) {
          throw new ConflictException('Item version conflict');
        }
        const state = await this.repository.state(manager, input.itemId, item.version);
        if (state.core_state === 'approved') {
          throw new ConflictException('Approved item is signed off');
        }
        const [inserted] = await manager.query<DecisionRow[]>(
          `insert into approval_decisions(id,item_id,item_version,participant_id,status,comment)
          values($1,$2,$3,$4,$5,$6) returning *`,
          [
            input.id,
            input.itemId,
            item.version,
            contact.participantId,
            input.status,
            input.comment ?? null,
          ],
        );
        const status = await this.calculate(manager, contact.boardId, input.itemId, item.version);
        await this.events.append(manager, contact.boardId, contact.participantId, {
          type: 'item.decided',
          payload: { itemId: input.itemId, itemVersion: item.version },
        });
        const next = await this.applyState(
          manager,
          contact.boardId,
          state,
          status,
          contact.participantId,
        );
        await manager.query(
          'update approval_decisions set result_status=$2,result_core_state=$3 where id=$1',
          [input.id, next.status, next.core_state],
        );
        const decision = decisionResponse({ ...inserted!, comment: input.comment ?? null });
        return {
          created: true,
          body: {
            approval: {
              itemId: input.itemId,
              itemVersion: item.version,
              status: next.status,
              coreState: next.core_state,
              ownDecision: decision,
            },
            decision,
          },
        };
      },
      false,
    );
  }
}
