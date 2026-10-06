import { z } from 'zod';
import {
  accountResponseSchema,
  boardDetailResponseSchema,
  boardListResponseSchema,
  boardWithRoleResponseSchema,
  itemListResponseSchema,
  itemResponseSchema,
  workspaceResponseSchema,
  clientResponseSchema,
  contactResponseSchema,
  contactParticipantResponseSchema,
  contactLinkResponseSchema,
  shareResponseSchema,
  presignResponseSchema,
  assetUrlResponseSchema,
  sectionResponseSchema,
} from '@moodboard/contracts';

export const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
    public retryAfter?: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `Request failed (${response.status})`;
    throw new ApiError(
      response.status,
      message,
      body,
      response.headers.get('Retry-After') ?? undefined,
    );
  }
  return schema.parse(body);
}

export const json = (value: unknown) => JSON.stringify(value);
export const noContent = z.null();
export const account = () => request('/me', accountResponseSchema);
export const workspaces = () => request('/workspaces', z.array(workspaceResponseSchema));
export const boards = (workspaceId: string) =>
  request(`/workspaces/${workspaceId}/boards`, boardListResponseSchema);
export const board = (id: string) => request(`/boards/${id}`, boardDetailResponseSchema);
export const items = (id: string) => request(`/boards/${id}/items`, itemListResponseSchema);
export const clients = (id: string, archived = false) =>
  request(`/workspaces/${id}/clients?includeArchived=${archived}`, z.array(clientResponseSchema));
export const contacts = (id: string) =>
  request(`/clients/${id}/contacts`, z.array(contactResponseSchema));
export const participants = (id: string) =>
  request(`/boards/${id}/participants`, z.array(contactParticipantResponseSchema));
export const clientBoard = () => request('/client/board', boardDetailResponseSchema);
export const clientItems = () => request('/client/board/items', itemListResponseSchema);

export const api = {
  login: (input: unknown) =>
    request('/auth/login', accountResponseSchema, { method: 'POST', body: json(input) }),
  signup: (input: unknown) =>
    request('/auth/signup', accountResponseSchema, { method: 'POST', body: json(input) }),
  logout: () => request('/auth/logout', noContent, { method: 'POST', body: '{}' }),
  createWorkspace: (name: string) =>
    request('/workspaces', workspaceResponseSchema, { method: 'POST', body: json({ name }) }),
  createBoard: (workspaceId: string, title: string, clientId?: string) =>
    request('/boards', boardWithRoleResponseSchema, {
      method: 'POST',
      body: json({ workspaceId, title, ...(clientId ? { clientId } : {}) }),
    }),
  updateBoard: (id: string, input: unknown) =>
    request(`/boards/${id}`, boardWithRoleResponseSchema, { method: 'PATCH', body: json(input) }),
  createSection: (id: string, name: string, position: string) =>
    request(`/boards/${id}/sections`, sectionResponseSchema, {
      method: 'POST',
      body: json({ name, position }),
    }),
  updateSection: (id: string, sid: string, input: unknown) =>
    request(`/boards/${id}/sections/${sid}`, sectionResponseSchema, {
      method: 'PATCH',
      body: json(input),
    }),
  deleteSection: (id: string, sid: string) =>
    request(`/boards/${id}/sections/${sid}`, noContent, { method: 'DELETE' }),
  createItem: (id: string, input: unknown) =>
    request(`/boards/${id}/items`, itemResponseSchema, { method: 'POST', body: json(input) }),
  updateItem: (id: string, input: unknown) =>
    request(`/items/${id}`, itemResponseSchema, { method: 'PATCH', body: json(input) }),
  moveItem: (id: string, input: unknown) =>
    request(`/items/${id}/position`, itemResponseSchema, { method: 'PATCH', body: json(input) }),
  deleteItem: (id: string) => request(`/items/${id}`, noContent, { method: 'DELETE' }),
  presign: (id: string, mime: string, bytes: number) =>
    request(`/boards/${id}/assets/presign`, presignResponseSchema, {
      method: 'POST',
      body: json({ mime, bytes }),
    }),
  assetUrl: (id: string, variant = 'thumbnail', client = false) =>
    request(
      `${client ? '/client' : ''}/assets/${id}/url?variant=${variant}`,
      assetUrlResponseSchema,
    ),
  createClient: (wid: string, name: string) =>
    request(`/workspaces/${wid}/clients`, clientResponseSchema, {
      method: 'POST',
      body: json({ name }),
    }),
  archiveClient: (id: string) => request(`/clients/${id}`, noContent, { method: 'DELETE' }),
  createContact: (cid: string, name: string, email?: string) =>
    request(`/clients/${cid}/contacts`, contactResponseSchema, {
      method: 'POST',
      body: json({ name, ...(email ? { email } : {}) }),
    }),
  removeContact: (id: string) => request(`/contacts/${id}`, noContent, { method: 'DELETE' }),
  assign: (bid: string, contactId: string, expiresAt: string | null) =>
    request(`/boards/${bid}/participants`, contactParticipantResponseSchema, {
      method: 'POST',
      body: json({ contactId, role: 'viewer', expiresAt }),
    }),
  updateParticipant: (bid: string, pid: string, input: unknown) =>
    request(`/boards/${bid}/participants/${pid}`, contactParticipantResponseSchema, {
      method: 'PATCH',
      body: json(input),
    }),
  revoke: (bid: string, pid: string) =>
    request(`/boards/${bid}/participants/${pid}`, noContent, { method: 'DELETE' }),
  link: (bid: string, pid: string) =>
    request(`/boards/${bid}/participants/${pid}/link`, contactLinkResponseSchema),
  rotate: (bid: string, pid: string) =>
    request(`/boards/${bid}/participants/${pid}/new-link`, contactLinkResponseSchema, {
      method: 'POST',
      body: '{}',
    }),
  exchange: (token: string) =>
    request(`/share/${encodeURIComponent(token)}`, shareResponseSchema, {
      headers: { Accept: 'application/json' },
    }),
  clientLogout: () => request('/client/logout', noContent, { method: 'POST', body: '{}' }),
};
