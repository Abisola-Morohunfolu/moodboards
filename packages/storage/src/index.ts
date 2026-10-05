import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';

export const r2EnvironmentSchema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
  R2_BUCKET: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  MEDIA_UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(2147483647)
    .default(10 * 1024 * 1024),
});
export type R2Config = z.infer<typeof r2EnvironmentSchema>;
export interface ObjectInfo {
  bytes: number;
  mime: string;
}
export interface Storage {
  presignPut(
    key: string,
    mime: string,
    bytes: number,
  ): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }>;
  presignGet(key: string, mime: string): Promise<{ url: string; expiresAt: string }>;
  head(key: string): Promise<ObjectInfo | null>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  put(key: string, body: Buffer, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  objects(prefix?: string): AsyncIterable<{ key: string; modifiedAt: Date }>;
  ready(): Promise<void>;
  close(): void;
}
export class ObjectTooLarge extends Error {}
export class StorageUnavailable extends Error {
  constructor() {
    super('Storage unavailable');
  }
}
export function r2Config(environment: Record<string, unknown>): R2Config | null {
  const fields = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  if (!fields.some((key) => environment[key] !== undefined && environment[key] !== '')) {
    return null;
  }
  const parsed = r2EnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('Invalid R2 configuration');
  }
  return parsed.data;
}
export class R2Storage implements Storage {
  readonly client: S3Client;
  // Tests inject a client for disposable local storage; app configuration is R2-only.
  constructor(
    readonly config: R2Config,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        region: 'auto',
        credentials: {
          accessKeyId: config.R2_ACCESS_KEY_ID,
          secretAccessKey: config.R2_SECRET_ACCESS_KEY,
        },
        maxAttempts: 1,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
  }
  async presignPut(key: string, mime: string, bytes: number) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.R2_BUCKET,
        Key: key,
        ContentType: mime,
        ContentLength: bytes,
      }),
      {
        expiresIn: 300,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      url,
      headers: { 'Content-Type': mime, 'Content-Length': String(bytes) },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }
  async presignGet(key: string, mime: string) {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.R2_BUCKET,
        Key: key,
        ResponseContentType: mime,
        ResponseCacheControl: 'private, max-age=300',
      }),
      { expiresIn: 300 },
    );
    return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
  async head(key: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.R2_BUCKET, Key: key }),
        { abortSignal: AbortSignal.timeout(2000) },
      );
      return { bytes: result.ContentLength ?? 0, mime: result.ContentType ?? '' };
    } catch (error) {
      if (error instanceof Error && ['NotFound', 'NoSuchKey'].includes(error.name)) {
        return null;
      }
      throw new StorageUnavailable();
    }
  }
  async read(key: string, maxBytes: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.R2_BUCKET, Key: key }),
        { abortSignal: controller.signal },
      );
      if (!result.Body) {
        throw new StorageUnavailable();
      }
      if ((result.ContentLength ?? 0) > maxBytes) {
        controller.abort();
        throw new ObjectTooLarge('Object exceeds byte limit');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > maxBytes) {
          controller.abort();
          throw new ObjectTooLarge('Object exceeds byte limit');
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally {
      clearTimeout(timer);
    }
  }
  async put(key: string, body: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: mime,
        ContentLength: body.length,
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.R2_BUCKET, Key: key }), {
      abortSignal: AbortSignal.timeout(2000),
    });
  }
  async *objects(prefix?: string) {
    let token: string | undefined;
    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.R2_BUCKET,
          ...(prefix ? { Prefix: prefix } : {}),
          ...(token ? { ContinuationToken: token } : {}),
        }),
        { abortSignal: AbortSignal.timeout(2000) },
      );
      for (const object of result.Contents ?? []) {
        if (object.Key && object.LastModified) {
          yield { key: object.Key, modifiedAt: object.LastModified };
        }
      }
      token = result.NextContinuationToken;
    } while (token);
  }
  async ready() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.R2_BUCKET }), {
      abortSignal: AbortSignal.timeout(2000),
    });
  }
  close() {
    this.client.destroy();
  }
}
