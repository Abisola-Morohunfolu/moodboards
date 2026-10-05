import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { withTransaction } from '@moodboard/database';
import { CreateContactRequest } from '@moodboard/contracts';
import { ClientsRepository } from './clients.repository';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { AccessRepository } from '../access/access.repository';

@Injectable()
export class ClientsService {
  constructor(
    private readonly source: DataSource,
    private readonly repository: ClientsRepository,
    private readonly events: BoardEventWriter,
    private readonly access: AccessRepository,
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
      if (contact.removed_at) {
        return;
      }
      const rows: { id: string; board_id: string }[] = await manager.query(
        `select p.id,p.board_id
        from board_participants p join boards b on b.id=p.board_id where p.contact_id=$1 order by b.id for update of b`,
        [contactId],
      );
      await manager.query(
        `update client_contacts set name='',email=null,removed_at=now(),link_version=link_version+1 where id=$1`,
        [contactId],
      );
      await manager.query('delete from contact_sessions where contact_id=$1', [contactId]);
      for (const row of rows) {
        await manager.query(
          `update board_participants set revoked_at=coalesce(revoked_at,now()),revoked_on_leave=false,link_version=link_version+1 where id=$1`,
          [row.id],
        );
        // Workspace recovery can authorize staff contact management without board.share.
        const actor = await this.access.ensureParticipant(manager, userId, row.board_id);
        await this.events.append(manager, row.board_id, actor, {
          type: 'access.changed',
          payload: { participantId: row.id, changedFields: ['revokedAt', 'linkVersion'] },
        });
      }
    });
  }
}
