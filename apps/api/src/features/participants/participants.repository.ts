import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  AssignContactRequest,
  ContactParticipantResponse,
  UpdateContactParticipantRequest,
} from '@moodboard/contracts';
import { EntityManager, DataSource } from 'typeorm';
import { lockContactParents } from '../access/contact-access';

export interface ContactAssignment {
  id: string;
  board_id: string;
  contact_id: string;
  role: 'viewer' | 'approver';
  expires_at: Date | null;
  revoked_at: Date | null;
  joined_at: Date;
  link_version: number;
}
export function participantResponse(p: ContactAssignment): ContactParticipantResponse {
  return {
    id: p.id,
    boardId: p.board_id,
    contactId: p.contact_id,
    role: p.role,
    expiresAt: p.expires_at?.toISOString() ?? null,
    revokedAt: p.revoked_at?.toISOString() ?? null,
    joinedAt: p.joined_at.toISOString(),
  };
}
export function validateExpiry(value: string | null | undefined) {
  if (value && new Date(value).getTime() <= Date.now()) {
    throw new BadRequestException('Expiry must be in the future');
  }
}
@Injectable()
export class ParticipantsRepository {
  constructor(private readonly source: DataSource) {}
  async identity(boardId: string, participantId: string) {
    const [row] = await this.source.query<{ contact_id: string }[]>(
      'select contact_id from board_participants where board_id=$1 and id=$2 and contact_id is not null',
      [boardId, participantId],
    );
    if (!row) {
      throw new NotFoundException('Participant not found');
    }
    return row.contact_id;
  }
  async lockContact(manager: EntityManager, contactId: string) {
    await lockContactParents(manager, contactId);
    const [contact] = await manager.query<{ client_id: string; archived_at: Date | null }[]>(
      `select ct.client_id,c.archived_at
      from client_contacts ct join clients c on c.id=ct.client_id where ct.id=$1 and ct.removed_at is null`,
      [contactId],
    );
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }
  async get(
    manager: EntityManager,
    boardId: string,
    participantId: string,
  ): Promise<ContactAssignment> {
    const [row] = await manager.query<ContactAssignment[]>(
      'select * from board_participants where board_id=$1 and id=$2 and contact_id is not null',
      [boardId, participantId],
    );
    if (!row) {
      throw new NotFoundException('Participant not found');
    }
    return row;
  }
  async list(manager: EntityManager, boardId: string) {
    const rows = await manager.query<ContactAssignment[]>(
      'select * from board_participants where board_id=$1 and contact_id is not null order by joined_at,id',
      [boardId],
    );
    return rows.map(participantResponse);
  }
  async assign(
    manager: EntityManager,
    boardId: string,
    clientId: string | null,
    userId: string,
    input: AssignContactRequest,
  ) {
    const contact = await this.lockContact(manager, input.contactId);
    if (contact.client_id !== clientId) {
      throw new NotFoundException('Contact not found');
    }
    if (contact.archived_at) {
      throw new ConflictException('Client is archived');
    }
    validateExpiry(input.expiresAt);
    const [old] = await manager.query<ContactAssignment[]>(
      'select * from board_participants where board_id=$1 and contact_id=$2',
      [boardId, input.contactId],
    );
    if (!old) {
      const [row] = await manager.query<ContactAssignment[]>(
        `insert into board_participants(id,board_id,contact_id,role,invited_by,expires_at)
        values($1,$2,$3,$4,$5,$6) returning *`,
        [randomUUID(), boardId, input.contactId, input.role, userId, input.expiresAt ?? null],
      );
      return {
        row: row!,
        created: true,
        restored: false,
        changedFields: [] as ('role' | 'expiresAt' | 'linkVersion')[],
      };
    }
    const restored =
      old.revoked_at !== null ||
      (old.expires_at !== null && old.expires_at.getTime() <= Date.now());
    const expires =
      input.expiresAt === undefined && !restored
        ? (old.expires_at?.toISOString() ?? null)
        : (input.expiresAt ?? null);
    const changedFields: ('role' | 'expiresAt' | 'linkVersion')[] = [];
    if (old.role !== input.role) {
      changedFields.push('role');
    }
    if ((old.expires_at?.toISOString() ?? null) !== expires) {
      changedFields.push('expiresAt');
    }
    if (restored) {
      changedFields.push('linkVersion');
    }
    if (!changedFields.length) {
      return { row: old, created: false, restored, changedFields };
    }
    const [row] = await manager.query<ContactAssignment[]>(
      `with updated as (update board_participants set role=$3,expires_at=$4,
      revoked_at=null,revoked_on_leave=false,link_version=link_version+$5 where board_id=$1 and id=$2 returning *) select * from updated`,
      [boardId, old.id, input.role, expires, restored ? 1 : 0],
    );
    if (restored) {
      await manager.query('delete from contact_sessions where participant_id=$1', [old.id]);
    }
    return { row: row!, created: false, restored, changedFields };
  }
  async update(
    manager: EntityManager,
    row: ContactAssignment,
    input: UpdateContactParticipantRequest,
  ) {
    validateExpiry(input.expiresAt);
    if (row.revoked_at || (row.expires_at && row.expires_at.getTime() <= Date.now())) {
      throw new ConflictException('Re-add participant to restore access');
    }
    const fields: ('role' | 'expiresAt')[] = [];
    if (input.role !== undefined && input.role !== row.role) {
      fields.push('role');
    }
    if (
      input.expiresAt !== undefined &&
      input.expiresAt !== (row.expires_at?.toISOString() ?? null)
    ) {
      fields.push('expiresAt');
    }
    if (!fields.length) {
      return { row, fields };
    }
    const [updated] = await manager.query<ContactAssignment[]>(
      `with updated as (update board_participants set role=$2,expires_at=$3 where id=$1 returning *) select * from updated`,
      [
        row.id,
        input.role ?? row.role,
        input.expiresAt === undefined ? row.expires_at : input.expiresAt,
      ],
    );
    return { row: updated!, fields };
  }
  async revoke(manager: EntityManager, row: ContactAssignment): Promise<boolean> {
    if (row.revoked_at) {
      return false;
    }
    await manager.query(
      'update board_participants set revoked_at=now(),revoked_on_leave=false,link_version=link_version+1 where id=$1',
      [row.id],
    );
    await manager.query('delete from contact_sessions where participant_id=$1', [row.id]);
    return true;
  }
  async rotate(manager: EntityManager, row: ContactAssignment): Promise<ContactAssignment> {
    const [updated] = await manager.query<ContactAssignment[]>(
      'with updated as (update board_participants set link_version=link_version+1 where id=$1 returning *) select * from updated',
      [row.id],
    );
    await manager.query('delete from contact_sessions where participant_id=$1', [row.id]);
    return updated!;
  }
  async assertActive(manager: EntityManager, row: ContactAssignment) {
    const [found] = await manager.query(
      `select 1 from boards b join client_contacts c on c.client_id=b.client_id
      where b.id=$1 and c.id=$2 and c.removed_at is null`,
      [row.board_id, row.contact_id],
    );
    if (
      !found ||
      row.revoked_at ||
      !['viewer', 'approver'].includes(row.role) ||
      (row.expires_at && row.expires_at.getTime() <= Date.now())
    ) {
      throw new NotFoundException('Participant not found');
    }
  }
}
