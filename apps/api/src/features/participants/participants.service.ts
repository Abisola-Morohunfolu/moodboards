import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AssignContactRequest, UpdateContactParticipantRequest } from '@moodboard/contracts';
import { AccessService } from '../access/access.service';
import { ContactLinks } from '../access/contact-links';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { ParticipantsRepository, participantResponse } from './participants.repository';
import { lockContactParents } from '../access/contact-access';
import { ApprovalsService } from '../approvals/approvals.service';

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: ParticipantsRepository,
    private readonly events: BoardEventWriter,
    private readonly links: ContactLinks,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}
  list(userId: string, boardId: string) {
    return this.access.withBoard(
      userId,
      boardId,
      'board.share',
      (m) => this.repository.list(m, boardId),
      false,
    );
  }
  assign(userId: string, boardId: string, input: AssignContactRequest) {
    return this.access.withBoard(
      userId,
      boardId,
      'board.share',
      async (manager, access) => {
        if (access.board.workspace_type !== 'business') {
          throw new NotFoundException('Contact not found');
        }
        const result = await this.repository.assign(
          manager,
          boardId,
          access.board.client_id,
          userId,
          input,
        );
        if (result.created || result.restored) {
          await this.events.append(manager, boardId, access.participantId!, {
            type: 'participant.joined',
            payload: { participantId: result.row.id },
          });
        } else if (result.changedFields.length) {
          await this.events.append(manager, boardId, access.participantId!, {
            type: 'access.changed',
            payload: { participantId: result.row.id, changedFields: result.changedFields },
          });
        }
        if (
          result.created ||
          result.restored ||
          result.changedFields.includes('role') ||
          result.changedFields.includes('expiresAt')
        ) {
          await this.approvals?.reconcileBoard(manager, boardId, access.participantId);
        }
        return { participant: participantResponse(result.row), created: result.created };
      },
      true,
      async (manager) => {
        await this.repository.lockContact(manager, input.contactId);
      },
    );
  }
  async change(
    userId: string,
    boardId: string,
    participantId: string,
    action: 'update' | 'revoke' | 'link' | 'rotate',
    input?: UpdateContactParticipantRequest,
  ) {
    const contactId = await this.repository.identity(boardId, participantId);
    return this.access.withBoard(
      userId,
      boardId,
      'board.share',
      async (manager, access) => {
        const row = await this.repository.get(manager, boardId, participantId);
        if (action === 'revoke') {
          if (await this.repository.revoke(manager, row)) {
            await this.events.append(manager, boardId, access.participantId!, {
              type: 'access.changed',
              payload: { participantId: row.id, changedFields: ['revokedAt', 'linkVersion'] },
            });
            await this.approvals?.reconcileBoard(manager, boardId, access.participantId);
          }
          return;
        }
        await this.repository.assertActive(manager, row);
        if (action === 'update') {
          const updated = await this.repository.update(manager, row, input!);
          if (updated.fields.length) {
            await this.events.append(manager, boardId, access.participantId!, {
              type: 'access.changed',
              payload: { participantId: row.id, changedFields: updated.fields },
            });
            await this.approvals?.reconcileBoard(manager, boardId, access.participantId);
          }
          return participantResponse(updated.row);
        }
        // Validate configuration before changing generation.
        this.links.configuration();
        if (action === 'rotate') {
          const rotated = await this.repository.rotate(manager, row);
          await this.events.append(manager, boardId, access.participantId!, {
            type: 'access.changed',
            payload: { participantId: row.id, changedFields: ['linkVersion'] },
          });
          return { url: this.links.url(row.id, rotated.link_version) };
        }
        return { url: this.links.url(row.id, row.link_version) };
      },
      action !== 'link',
      (manager) => lockContactParents(manager, contactId),
    );
  }
}
