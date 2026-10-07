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
import { decisionResponse } from './approvals.mapper';
import { ApprovalStateRow, ApprovalsRepository } from './approvals.repository';

function coreState(status: ApprovalStateRow['status']): ApprovalStateRow['coreState'] {
  return status === 'approved' ? 'approved' : status === 'pending' ? 'pending' : 'rejected';
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: ApprovalsRepository,
    private readonly events: BoardEventWriter,
  ) {}

  private assertAvailable(access: BoardAccess): void {
    if (access.board.workspaceType !== 'business' || access.board.clientId === null) {
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
    const next = { ...state, status, coreState: coreState(status) };
    await this.repository.updateState(manager, next);
    if (state.coreState !== next.coreState) {
      await this.events.append(manager, boardId, actorId, {
        type: 'approval.state_changed',
        payload: {
          itemId: state.itemId,
          itemVersion: state.itemVersion,
          coreState: next.coreState,
        },
      });
    }
    return next;
  }

  // Callers hold the board lock. Approved item versions are deliberately frozen.
  async reconcileBoard(manager: EntityManager, boardId: string, actorId: string | null) {
    const candidates = await this.repository.reconciliationCandidates(manager, boardId);
    for (const { nextStatus, ...state } of candidates) {
      if (state.status !== nextStatus) {
        await this.applyState(manager, boardId, state, nextStatus, actorId);
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
    const previous = await this.repository.lockState(manager, itemId);
    if (!previous) {
      return;
    }
    await this.repository.updateState(manager, {
      ...previous,
      itemVersion: version,
      status: 'pending',
      coreState: 'pending',
    });
    if (previous.coreState !== 'pending') {
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
    const items = await this.repository.itemVersions(manager, boardId);
    const states = new Map(
      (await this.repository.states(manager, boardId)).map((s) => [s.itemId, s]),
    );
    const decisions = await this.repository.latestDecisions(manager, boardId);
    return items.map((item) => {
      const state = states.get(item.id);
      const base = {
        itemId: item.id,
        itemVersion: item.version,
        status: state?.status ?? 'pending',
        coreState: state?.coreState ?? 'pending',
      } as const;
      const itemDecisions = decisions.filter((d) => d.itemId === item.id);
      if (contactId) {
        const own = itemDecisions.find((d) => d.participantId === contactId);
        return { ...base, ownDecision: own ? decisionResponse(own) : null };
      }
      return {
        ...base,
        decisions: itemDecisions.map((d) => ({
          ...decisionResponse(d),
          participantId: d.participantId,
          contactId: d.contactId,
          contactName: d.contactName,
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
        if (access.role !== 'approver' || access.board.participantRole !== 'approver') {
          throw new ForbiddenException('Approver assignment required');
        }
        const old = await this.repository.existingDecision(manager, input.id);
        if (old) {
          if (
            old.participantId !== contact.participantId ||
            old.itemId !== input.itemId ||
            old.itemVersion !== input.itemVersion ||
            old.status !== input.status ||
            old.comment !== (input.comment ?? null)
          ) {
            throw new ConflictException('Decision id already in use');
          }
          return {
            created: false,
            body: {
              approval: {
                itemId: old.itemId,
                itemVersion: old.itemVersion,
                status: old.resultStatus!,
                coreState: old.resultCoreState!,
                ownDecision: decisionResponse(old),
              },
              decision: decisionResponse(old),
            },
          };
        }
        const item = await this.repository.itemVersion(manager, contact.boardId, input.itemId);
        if (!item) {
          throw new NotFoundException('Item not found');
        }
        if (item.version !== input.itemVersion) {
          throw new ConflictException('Item version conflict');
        }
        const state = await this.repository.state(manager, input.itemId, item.version);
        if (state.coreState === 'approved') {
          throw new ConflictException('Approved item is signed off');
        }
        const inserted = await this.repository.insertDecision(manager, {
          id: input.id,
          itemId: input.itemId,
          itemVersion: item.version,
          participantId: contact.participantId,
          status: input.status,
          comment: input.comment ?? null,
        });
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
        await this.repository.updateDecisionResult(manager, input.id, next);
        const decision = decisionResponse({ ...inserted!, comment: input.comment ?? null });
        return {
          created: true,
          body: {
            approval: {
              itemId: input.itemId,
              itemVersion: item.version,
              status: next.status,
              coreState: next.coreState,
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
