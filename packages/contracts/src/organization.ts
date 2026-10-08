import { z } from 'zod';
import { boardWithRoleResponseSchema, sectionResponseSchema } from './boards';
import { itemResponseSchema } from './media';

export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
});
export const workspaceSearchQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(200),
  boardId: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .optional(),
  kind: z.enum(['note', 'image', 'link']).optional(),
});
export const workspaceSearchHitSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('board'), board: boardWithRoleResponseSchema }),
  z.strictObject({
    type: z.literal('item'),
    board: boardWithRoleResponseSchema,
    section: sectionResponseSchema.nullable(),
    item: itemResponseSchema,
  }),
]);
export const workspaceSearchResponseSchema = z.strictObject({
  results: z.array(workspaceSearchHitSchema).max(20),
  nextCursor: z.string().nullable(),
});
export const trashPageResponseSchema = z.strictObject({
  items: z.array(itemResponseSchema).max(20),
  nextCursor: z.string().nullable(),
});
export const restoreItemRequestSchema = z.strictObject({ deletedAt: z.iso.datetime() });
export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuerySchema>;
export type WorkspaceSearchHit = z.infer<typeof workspaceSearchHitSchema>;
export type WorkspaceSearchResponse = z.infer<typeof workspaceSearchResponseSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
export type RestoreItemRequest = z.infer<typeof restoreItemRequestSchema>;
