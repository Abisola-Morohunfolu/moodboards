import { z } from 'zod';

const databaseUrl = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      url.hostname !== '' &&
      url.pathname.length > 1
    );
  });
const environmentSchema = z.object({
  DATABASE_URL: databaseUrl,
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ApiConfig = z.infer<typeof environmentSchema>;

export function validateEnvironment(environment: Record<string, unknown>): ApiConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    // Report field names only. Connection strings can contain credentials.
    throw new Error(`Invalid API configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
