import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { R2Storage, r2EnvironmentSchema } from '@moodboard/storage';

export function testStorageOptions(environment = process.env) {
  const endpoint = environment.TEST_STORAGE_ENDPOINT;
  const bucket = environment.TEST_STORAGE_BUCKET;
  if (!endpoint || !bucket || !bucket.startsWith('moodboard-test-')) {
    throw new Error('Set TEST_STORAGE_ENDPOINT and a moodboard-test- bucket for disposable MinIO');
  }
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    bucket === environment.R2_BUCKET
  ) {
    throw new Error('Test storage must be disposable loopback MinIO, separate from R2');
  }
  return { endpoint, bucket };
}

export function createTestStorage() {
  const { endpoint, bucket } = testStorageOptions();
  return new R2Storage(
    r2EnvironmentSchema.parse({
      R2_ACCOUNT_ID: '0'.repeat(32),
      R2_BUCKET: bucket,
      R2_ACCESS_KEY_ID: 'moodboard_test',
      R2_SECRET_ACCESS_KEY: 'moodboard_test_secret',
    }),
    new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'moodboard_test', secretAccessKey: 'moodboard_test_secret' },
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  );
}

export async function testStorage() {
  const storage = createTestStorage();
  try {
    await storage.client.send(new CreateBucketCommand({ Bucket: storage.config.R2_BUCKET }));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)
    ) {
      storage.close();
      throw error;
    }
  }
  return storage;
}
