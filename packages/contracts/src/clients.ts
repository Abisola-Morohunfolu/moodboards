import { z } from 'zod';
import { boardResponseSchema, boardRoleSchema } from './boards';

const name = z.string().trim().min(1).max(100);
export const emptyRequestSchema = z.strictObject({});
export const shareResponseSchema = z.strictObject({
  board: boardResponseSchema,
  role: boardRoleSchema,
});
export const createClientRequestSchema = z.strictObject({ name });
export const clientListQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export const createContactRequestSchema = z.strictObject({
  name,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
export const clientResponseSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});
export const contactResponseSchema = z.strictObject({
  id: z.uuid(),
  clientId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
});
const contactRole = z.enum(['viewer', 'approver']);
const expiry = z.iso
  .datetime()
  .transform((v) => new Date(v).toISOString())
  .nullable();
export const assignContactRequestSchema = z.strictObject({
  contactId: z.uuid().transform((v) => v.toLowerCase()),
  role: contactRole,
  expiresAt: expiry.optional(),
});
export const updateContactParticipantRequestSchema = z
  .strictObject({
    role: contactRole.optional(),
    expiresAt: expiry.optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined));
export const contactParticipantResponseSchema = z.strictObject({
  id: z.uuid(),
  boardId: z.uuid(),
  contactId: z.uuid(),
  role: contactRole,
  expiresAt: expiry,
  revokedAt: expiry,
  joinedAt: z.iso.datetime(),
});
export const contactLinkResponseSchema = z.strictObject({ url: z.url() });
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;
export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;
export type ClientResponse = z.infer<typeof clientResponseSchema>;
export type ContactResponse = z.infer<typeof contactResponseSchema>;
export type AssignContactRequest = z.infer<typeof assignContactRequestSchema>;
export type UpdateContactParticipantRequest = z.infer<typeof updateContactParticipantRequestSchema>;
export type ContactParticipantResponse = z.infer<typeof contactParticipantResponseSchema>;
