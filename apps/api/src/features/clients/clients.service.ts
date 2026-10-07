import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { withTransaction } from '@moodboard/database';
import { CreateContactRequest } from '@moodboard/contracts';
import { ClientsRepository } from './clients.repository';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { AccessRepository } from '../access/access.repository';
import { ApprovalsService } from '../approvals/approvals.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly source: DataSource,
    private readonly repository: ClientsRepository,
    private readonly events: BoardEventWriter,
    private readonly access: AccessRepository,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}
  list(userId: string, workspaceId: string, archived: boolean) {
    return withTransaction(this.source, (m) =>
      this.repository.list(m, userId, workspaceId, archived),
    );
  }
  create(userId: string, workspaceId: string, name: string) {
    return withTransaction(this.source, (m) =>
      this.repository.create(m, userId, workspaceId, name),
    );
  }
  archive(userId: string, clientId: string) {
    return withTransaction(this.source, (m) => this.repository.archive(m, userId, clientId));
  }
  contacts(userId: string, clientId: string) {
    return withTransaction(this.source, (m) => this.repository.contacts(m, userId, clientId));
  }
  createContact(userId: string, clientId: string, input: CreateContactRequest) {
    return withTransaction(this.source, (m) =>
      this.repository.createContact(m, userId, clientId, input),
    );
  }
  removeContact(userId: string, contactId: string) {
    return withTransaction(this.source, async (manager) => {
      const contact = await this.repository.contact(manager, userId, contactId);
      if (contact.removedAt) {
        return;
      }
      const rows = await this.repository.lockAssignments(manager, contactId);
      await this.repository.anonymizeContact(manager, contactId);
      for (const row of rows) {
        await this.repository.revokeAssignment(manager, row.id);
        // Workspace recovery can authorize staff contact management without board.share.
        const actor = await this.access.ensureParticipant(manager, userId, row.boardId);
        await this.events.append(manager, row.boardId, actor, {
          type: 'access.changed',
          payload: { participantId: row.id, changedFields: ['revokedAt', 'linkVersion'] },
        });
        await this.approvals?.reconcileBoard(manager, row.boardId, actor);
      }
    });
  }
}
