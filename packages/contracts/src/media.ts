import { z } from 'zod';
import { createNoteRequestSchema, noteResponseSchema } from './boards';

export function normalizeLink(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new Error('Invalid link URL');
  }
  url.hash = '';
  return url.href;
}
export const linkUrlSchema = z
  .string()
  .max(8192)
  .refine(
    (value) => {
      try {
        normalizeLink(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Expected an HTTP(S) URL on port 80 or 443 without credentials' },
  )
  .transform(normalizeLink);
export const jobStatusSchema = z.enum(['pending', 'ready', 'failed']);
export const imageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const presignRequestSchema = z.strictObject({
  mime: imageMimeSchema,
  bytes: z.number().int().positive().max(2147483647),
});
export const presignResponseSchema = z.strictObject({
  assetId: z.uuid(),
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export const assetUrlQuerySchema = z.strictObject({
  variant: z.enum(['original', 'thumbnail']).default('original'),
});
export const assetUrlResponseSchema = z.strictObject({ url: z.url(), expiresAt: z.iso.datetime() });
export const createImageRequestSchema = createNoteRequestSchema.extend({
  kind: z.literal('image'),
  assetId: z.uuid(),
});
export const createLinkRequestSchema = createNoteRequestSchema.extend({
  kind: z.literal('link'),
  url: linkUrlSchema,
});
export const createItemRequestSchema = z.discriminatedUnion('kind', [
  createNoteRequestSchema,
  createImageRequestSchema,
  createLinkRequestSchema,
]);
export const assetResponseSchema = z.strictObject({
  id: z.uuid(),
  status: jobStatusSchema,
  mime: imageMimeSchema,
  bytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/)).nullable(),
});
export const previewResponseSchema = z.strictObject({
  id: z.uuid(),
  url: z.string(),
  status: jobStatusSchema,
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  siteName: z.string().nullable(),
  fetchedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export const imageResponseSchema = noteResponseSchema.extend({
  kind: z.literal('image'),
  asset: assetResponseSchema,
});
export const linkResponseSchema = noteResponseSchema.extend({
  kind: z.literal('link'),
  preview: previewResponseSchema,
});
export const itemResponseSchema = z.discriminatedUnion('kind', [
  noteResponseSchema,
  imageResponseSchema,
  linkResponseSchema,
]);
export const itemListResponseSchema = z.array(itemResponseSchema);
export const itemConflictResponseSchema = z.strictObject({
  statusCode: z.literal(409),
  message: z.literal('Item version conflict'),
  currentItem: itemResponseSchema,
});
export const mediaJobSchema = z.strictObject({
  entityId: z.uuid(),
  generation: z.string().max(100),
});
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
export type PresignRequest = z.infer<typeof presignRequestSchema>;
export type MediaJob = z.infer<typeof mediaJobSchema>;
