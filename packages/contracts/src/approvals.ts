import { z } from 'zod';

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'swap_requested']);
export const decisionStatusSchema = z.enum(['approved', 'rejected', 'swap_requested']);
export const decisionRequestSchema = z
  .strictObject({
    id: z.uuid(),
    itemId: z.uuid(),
    itemVersion: z.number().int().positive(),
    status: decisionStatusSchema,
    comment: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .refine((value) => value.status !== 'swap_requested' || Boolean(value.comment), {
    path: ['comment'],
    message: 'A swap request needs a comment',
  });
export const approvalDecisionSchema = z.strictObject({
  id: z.uuid(),
  itemId: z.uuid(),
  itemVersion: z.number().int().positive(),
  status: decisionStatusSchema,
  comment: z.string().nullable(),
  decidedAt: z.iso.datetime(),
});
export const plannerDecisionSchema = approvalDecisionSchema.extend({
  participantId: z.uuid(),
  contactId: z.uuid(),
  contactName: z.string(),
});
export const approvalStateSchema = z.strictObject({
  itemId: z.uuid(),
  itemVersion: z.number().int().positive(),
  status: approvalStatusSchema,
  coreState: z.enum(['pending', 'approved', 'rejected']),
});
export const plannerApprovalSchema = approvalStateSchema.extend({
  decisions: z.array(plannerDecisionSchema),
});
export const clientApprovalSchema = approvalStateSchema.extend({
  ownDecision: approvalDecisionSchema.nullable(),
});
export const plannerApprovalListSchema = z.array(plannerApprovalSchema);
export const clientApprovalListSchema = z.array(clientApprovalSchema);
export const decisionResponseSchema = z.strictObject({
  approval: clientApprovalSchema,
  decision: approvalDecisionSchema,
});
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type PlannerApproval = z.infer<typeof plannerApprovalSchema>;
export type ClientApproval = z.infer<typeof clientApprovalSchema>;
