import { z } from 'zod';

export const boardRoleSchema = z.enum(['viewer', 'approver', 'editor', 'owner']);
export type BoardRole = z.infer<typeof boardRoleSchema>;
export const orderingKeySchema = z.string().regex(/^[0-9A-Za-z]{1,128}$/);
const titleSchema = z.string().trim().min(1).max(200);
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .nullable();
const coordinateSchema = z
  .number()
  .finite()
  .min(-3.402823466e38)
  .max(3.402823466e38)
  .refine((value) => value === 0 || Math.fround(value) !== 0, {
    message: 'Coordinate is too small for Postgres real',
  });
const integerSchema = z.number().int().max(2147483647);
const changed = (value: Record<string, unknown>) =>
  Object.keys(value).some((key) => key !== 'version' && value[key] !== undefined);

export const createBoardRequestSchema = z.strictObject({
  workspaceId: z.uuid(),
  title: titleSchema,
  kitId: z.literal('blank').optional(),
  currency: currencySchema.optional(),
  clientId: z
    .uuid()
    .transform((v) => v.toLowerCase())
    .optional(),
});
export const updateBoardRequestSchema = z
  .strictObject({
    title: titleSchema.optional(),
    currency: currencySchema.optional(),
    clientId: z
      .uuid()
      .transform((v) => v.toLowerCase())
      .nullable()
      .optional(),
  })
  .refine(changed);
export const createSectionRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  position: orderingKeySchema,
});
export const updateSectionRequestSchema = createSectionRequestSchema.partial().refine(changed);
const noteContent = {
  title: titleSchema.nullable().optional(),
  note: z.string().max(20000).nullable().optional(),
  priceCents: integerSchema.nonnegative().nullable().optional(),
  quantity: integerSchema.positive().optional(),
};
const position = {
  x: coordinateSchema.optional(),
  y: coordinateSchema.optional(),
  zOrder: orderingKeySchema.optional(),
  sectionId: z.uuid().nullable().optional(),
};
export const createNoteRequestSchema = z.strictObject({
  id: z.uuid(),
  kind: z.literal('note'),
  ...noteContent,
  ...position,
  zOrder: orderingKeySchema,
});
export const updateNoteRequestSchema = z
  .strictObject({
    ...noteContent,
    version: integerSchema.positive(),
  })
  .refine(changed);
export const moveNoteRequestSchema = z.strictObject(position).refine(changed);

export const boardResponseSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  clientId: z.uuid().nullable(),
  kitId: z.string(),
  title: z.string(),
  layout: z.enum(['canvas', 'grid']),
  currency: currencySchema,
  generalAccess: z.enum(['restricted', 'workspace', 'link']),
  workspaceDefaultRole: boardRoleSchema,
  showPricesTo: boardRoleSchema,
  eventSeq: z.string().regex(/^(0|[1-9][0-9]*)$/),
  lockedAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const boardWithRoleResponseSchema = boardResponseSchema.extend({ role: boardRoleSchema });
export const boardListResponseSchema = z.array(boardWithRoleResponseSchema);
export const sectionResponseSchema = z.strictObject({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  position: orderingKeySchema,
});
export const boardDetailResponseSchema = z.strictObject({
  board: boardResponseSchema,
  sections: z.array(sectionResponseSchema),
  modules: z.array(z.never()).length(0),
  role: boardRoleSchema,
});
export const noteResponseSchema = z.strictObject({
  id: z.uuid(),
  boardId: z.uuid(),
  sectionId: z.uuid().nullable(),
  createdBy: z.uuid(),
  kind: z.literal('note'),
  title: z.string().nullable(),
  note: z.string().nullable(),
  // Postgres real's text representation can round slightly above the input bound.
  x: z.number().finite().nullable(),
  y: z.number().finite().nullable(),
  zOrder: orderingKeySchema,
  priceCents: integerSchema.nonnegative().nullable().optional(),
  quantity: integerSchema.positive(),
  version: integerSchema.positive(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const noteListResponseSchema = z.array(noteResponseSchema);
export const noteConflictResponseSchema = z.strictObject({
  statusCode: z.literal(409),
  message: z.literal('Item version conflict'),
  currentItem: noteResponseSchema,
});

const boardFields = z.array(z.enum(['title', 'currency', 'clientId'])).min(1);
const sectionFields = z.array(z.enum(['name', 'position'])).min(1);
const itemFields = z.array(z.enum(['title', 'note', 'priceCents', 'quantity'])).min(1);
const positionFields = z.array(z.enum(['x', 'y', 'zOrder', 'sectionId'])).min(1);
export const boardCoreEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('board.created'),
    payload: z.strictObject({ boardId: z.uuid() }),
  }),
  z.strictObject({
    type: z.literal('board.updated'),
    payload: z.strictObject({ boardId: z.uuid(), changedFields: boardFields }),
  }),
  z.strictObject({
    type: z.literal('section.created'),
    payload: z.strictObject({ sectionId: z.uuid() }),
  }),
  z.strictObject({
    type: z.literal('section.updated'),
    payload: z.strictObject({ sectionId: z.uuid(), changedFields: sectionFields }),
  }),
  z.strictObject({
    type: z.literal('section.deleted'),
    payload: z.strictObject({ sectionId: z.uuid() }),
  }),
  z.strictObject({
    type: z.literal('item.created'),
    payload: z.strictObject({
      itemId: z.uuid(),
      kind: z.enum(['note', 'image', 'link']),
      assetId: z.uuid().optional(),
      previewId: z.uuid().optional(),
      version: integerSchema.positive(),
    }),
  }),
  z.strictObject({
    type: z.literal('item.restored'),
    payload: z.strictObject({
      itemId: z.uuid(),
      kind: z.enum(['note', 'image', 'link']),
      assetId: z.uuid().optional(),
      previewId: z.uuid().optional(),
      version: integerSchema.positive(),
    }),
  }),
  z.strictObject({
    type: z.literal('item.updated'),
    payload: z.strictObject({
      itemId: z.uuid(),
      version: integerSchema.positive(),
      changedFields: itemFields,
    }),
  }),
  z.strictObject({
    type: z.literal('item.moved'),
    payload: z.strictObject({ itemId: z.uuid(), changedFields: positionFields }),
  }),
  z.strictObject({
    type: z.literal('item.deleted'),
    payload: z.strictObject({ itemId: z.uuid() }),
  }),
]);
export const boardEventSchema = z.discriminatedUnion('type', [
  ...boardCoreEventSchema.options,
  z.strictObject({
    type: z.literal('participant.joined'),
    payload: z.strictObject({ participantId: z.uuid() }),
  }),
  z.strictObject({
    type: z.literal('access.changed'),
    payload: z.strictObject({
      participantId: z.uuid(),
      changedFields: z.array(z.enum(['role', 'expiresAt', 'revokedAt', 'linkVersion'])).min(1),
    }),
  }),
  ...(['asset.ready', 'asset.failed'] as const).map((type) =>
    z.strictObject({ type: z.literal(type), payload: z.strictObject({ assetId: z.uuid() }) }),
  ),
  ...(['preview.ready', 'preview.failed'] as const).map((type) =>
    z.strictObject({ type: z.literal(type), payload: z.strictObject({ previewId: z.uuid() }) }),
  ),
  z.strictObject({
    type: z.literal('item.decided'),
    payload: z.strictObject({ itemId: z.uuid(), itemVersion: integerSchema.positive() }),
  }),
  z.strictObject({
    type: z.literal('approval.state_changed'),
    payload: z.strictObject({
      itemId: z.uuid(),
      itemVersion: integerSchema.positive(),
      coreState: z.enum(['pending', 'approved', 'rejected']),
    }),
  }),
]);
export type BoardEvent = z.infer<typeof boardEventSchema>;
export type BoardCoreEvent = z.infer<typeof boardCoreEventSchema>;
export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;
export type UpdateBoardRequest = z.infer<typeof updateBoardRequestSchema>;
export type CreateSectionRequest = z.infer<typeof createSectionRequestSchema>;
export type UpdateSectionRequest = z.infer<typeof updateSectionRequestSchema>;
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;
export type MoveNoteRequest = z.infer<typeof moveNoteRequestSchema>;
export type BoardResponse = z.infer<typeof boardResponseSchema>;
export type BoardWithRoleResponse = z.infer<typeof boardWithRoleResponseSchema>;
export type BoardDetailResponse = z.infer<typeof boardDetailResponseSchema>;
export type SectionResponse = z.infer<typeof sectionResponseSchema>;
export type NoteResponse = z.infer<typeof noteResponseSchema>;
