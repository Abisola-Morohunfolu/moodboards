import { z } from 'zod';

export * from './boards';

export const liveResponseSchema = z.strictObject({ status: z.literal('ok') });
const checkStatusSchema = z.enum(['ok', 'down']);
export const readyResponseSchema = z
  .strictObject({
    status: checkStatusSchema,
    checks: z.strictObject({ postgres: checkStatusSchema, migrations: checkStatusSchema }),
  })
  .refine(
    ({ status, checks }) =>
      status === (checks.postgres === 'ok' && checks.migrations === 'ok' ? 'ok' : 'down'),
  );

export type LiveResponse = z.infer<typeof liveResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const signupRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(15).max(128),
  displayName: z.string().trim().min(1).max(100),
});
export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const createWorkspaceRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});
export const userResponseSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const workspaceResponseSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(['personal', 'business']),
  name: z.string(),
  logoKey: z.string().nullable(),
  brandColour: z.string().nullable(),
  createdAt: z.iso.datetime(),
  role: z.enum(['owner', 'staff', 'partner']),
});
export const workspaceListResponseSchema = z.array(workspaceResponseSchema);
export const accountResponseSchema = z.strictObject({
  user: userResponseSchema,
  workspaces: workspaceListResponseSchema,
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;

export * from './media';
