import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ClientResponse, ContactResponse, CreateContactRequest } from '@moodboard/contracts';
import { lockContactParents } from '../access/contact-access';

const clientColumns = `id, workspace_id as "workspaceId", name,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
  case when archived_at is null then null else to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as "archivedAt"`;
const contactColumns = 'id, client_id as "clientId", name, email';

export async function assertBusinessMember(
  manager: EntityManager,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [row] = await manager.query(
    `select w.type, m.role from workspaces w
    join workspace_members m on m.workspace_id=w.id and m.user_id=$2
    where w.id=$1 for key share of m`,
    [workspaceId, userId],
  );
  if (!row) {
    throw new NotFoundException('Workspace not found');
  }
  if (row.type !== 'business' || !['owner', 'staff'].includes(row.role)) {
    throw new ForbiddenException('Business workspace permission required');
  }
}
export async function lockBusinessClient(
  manager: EntityManager,
  userId: string,
  clientId: string,
  workspaceId?: string,
  active = true,
): Promise<ClientResponse> {
  const [client] = await manager.query<ClientResponse[]>(
    `select ${clientColumns} from clients where id=$1 for update`,
    [clientId],
  );
  if (!client || (workspaceId && client.workspaceId !== workspaceId)) {
    throw new NotFoundException('Client not found');
  }
  await assertBusinessMember(manager, userId, client.workspaceId);
  if (active && client.archivedAt) {
    throw new ConflictException('Client is archived');
  }
  return client;
}
@Injectable()
export class ClientsRepository {
  async list(manager: EntityManager, userId: string, workspaceId: string, archived: boolean) {
    await assertBusinessMember(manager, userId, workspaceId);
    return manager.query<ClientResponse[]>(
      `select ${clientColumns} from clients where workspace_id=$1
      ${archived ? '' : 'and archived_at is null'} order by created_at, id`,
      [workspaceId],
    );
  }
  async create(manager: EntityManager, userId: string, workspaceId: string, name: string) {
    await assertBusinessMember(manager, userId, workspaceId);
    const [client] = await manager.query<ClientResponse[]>(
      `insert into clients(id,workspace_id,name) values($1,$2,$3) returning ${clientColumns}`,
      [randomUUID(), workspaceId, name],
    );
    return client;
  }
  async archive(manager: EntityManager, userId: string, clientId: string) {
    await lockBusinessClient(manager, userId, clientId, undefined, false);
    await manager.query('update clients set archived_at=coalesce(archived_at,now()) where id=$1', [
      clientId,
    ]);
  }
  async contacts(manager: EntityManager, userId: string, clientId: string) {
    await lockBusinessClient(manager, userId, clientId, undefined, false);
    return manager.query<ContactResponse[]>(
      `select ${contactColumns} from client_contacts where client_id=$1 and removed_at is null order by id`,
      [clientId],
    );
  }
  async createContact(
    manager: EntityManager,
    userId: string,
    clientId: string,
    input: CreateContactRequest,
  ) {
    await lockBusinessClient(manager, userId, clientId);
    const [contact] = await manager.query<ContactResponse[]>(
      `insert into client_contacts(id,client_id,name,email) values($1,$2,$3,$4) returning ${contactColumns}`,
      [randomUUID(), clientId, input.name, input.email ?? null],
    );
    return contact;
  }
  async contact(manager: EntityManager, userId: string, contactId: string) {
    await lockContactParents(manager, contactId);
    const [contact] = await manager.query<
      { id: string; client_id: string; removed_at: Date | null }[]
    >('select id,client_id,removed_at from client_contacts where id=$1', [contactId]);
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    await lockBusinessClient(manager, userId, contact.client_id, undefined, false);
    return contact;
  }
}
