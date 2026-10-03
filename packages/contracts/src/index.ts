import { z } from 'zod';

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
