import { z } from 'zod';
import { r2Config } from '@moodboard/storage';

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
const originSchema = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  });
const environmentSchema = z
  .object({
    DATABASE_URL: databaseUrl,
    R2_ACCOUNT_ID: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    MEDIA_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().max(2147483647).optional(),
    REDIS_URL: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) {
          return false;
        }
        const url = new URL(value);
        return (
          ['redis:', 'rediss:'].includes(url.protocol) &&
          url.hostname !== '' &&
          /^(\/\d*)?$/.test(url.pathname) &&
          !url.search &&
          !url.hash
        );
      })
      .default('redis://127.0.0.1:6379'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    AUTH_ALLOWED_ORIGINS: z.preprocess(
      (value) =>
        typeof value === 'string' ? value.split(',').map((origin) => origin.trim()) : value,
      z.array(originSchema).min(1).default(['http://localhost:3000', 'http://127.0.0.1:3000']),
    ),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALLBACK_URL: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) {
          return false;
        }
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.pathname === '/auth/google/callback' &&
          !url.search &&
          !url.hash
        );
      })
      .optional(),
  })
  .superRefine((config, context) => {
    try {
      r2Config(config);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['R2_BUCKET'],
        message: 'Configure all R2 fields',
      });
    }
    const google = [
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
      config.GOOGLE_CALLBACK_URL,
    ];
    if (google.some(Boolean) && !google.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'Configure all Google fields',
      });
    }
    if (config.NODE_ENV === 'production') {
      if (config.AUTH_ALLOWED_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
        context.addIssue({
          code: 'custom',
          path: ['AUTH_ALLOWED_ORIGINS'],
          message: 'HTTPS required',
        });
      }
      if (config.GOOGLE_CALLBACK_URL && !config.GOOGLE_CALLBACK_URL.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_CALLBACK_URL'],
          message: 'HTTPS required',
        });
      }
    }
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
