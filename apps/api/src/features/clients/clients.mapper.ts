import { ClientResponse, ContactResponse } from '@moodboard/contracts';
import { ClientEntity, ClientContactEntity } from '@moodboard/database';
export function clientResponse(client: ClientEntity): ClientResponse {
  return {
    id: client.id,
    workspaceId: client.workspaceId,
    name: client.name,
    createdAt: client.createdAt.toISOString(),
    archivedAt: client.archivedAt?.toISOString() ?? null,
  };
}
export function contactResponse(contact: ClientContactEntity): ContactResponse {
  return { id: contact.id, clientId: contact.clientId, name: contact.name, email: contact.email };
}
