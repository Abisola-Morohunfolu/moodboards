import { createServer } from 'node:http';
import { URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';
import { R2Storage, r2EnvironmentSchema } from '../packages/storage/dist/index.js';
const endpoint = process.env.TEST_STORAGE_ENDPOINT;
const bucket = process.env.TEST_STORAGE_BUCKET;
if (!endpoint || !bucket?.startsWith('moodboard-test-') || bucket === process.env.R2_BUCKET) {
  throw new Error(
    'Browser smoke requires disposable TEST_STORAGE_ENDPOINT and TEST_STORAGE_BUCKET',
  );
}
const url = new URL(endpoint);
if (
  url.protocol !== 'http:' ||
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  url.username ||
  url.password ||
  url.pathname !== '/' ||
  url.search ||
  url.hash
) {
  throw new Error('Browser smoke requires disposable loopback MinIO');
}
const storage = new R2Storage(
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
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }),
);
const body = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
  .png()
  .toBuffer();
const key = `browser-smoke/${randomUUID()}`;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/reservation') {
    void storage
      .presignPut(key, 'image/png', body.length)
      .then((signed) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ ...signed, bytes: [...body] }));
      })
      .catch(() => {
        response.statusCode = 503;
        response.end('{}');
      });
    return;
  }
  if (request.url === '/result') {
    void storage
      .head(key)
      .then(async (object) => {
        const valid =
          object?.bytes === body.length &&
          object.mime === 'image/png' &&
          (await storage.read(key, body.length)).equals(body);
        console.info(
          JSON.stringify({ browserUpload: valid ? 'passed' : 'failed', bytes: object?.bytes }),
        );
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ verified: valid }));
      })
      .catch(() => {
        response.statusCode = 503;
        response.end('{}');
      });
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><title>Browser upload verification</title></head><body><h1>Browser upload verification</h1><button id="upload">Run upload test</button><p id="status">Ready</p><script>
  document.querySelector('#upload').onclick=async()=>{
    const status=document.querySelector('#status');status.textContent='Uploading';
    try {
      const data=await(await fetch('/reservation')).json();
      const file=new Blob([new Uint8Array(data.bytes)],{type:'image/png'});
      const result=await fetch(data.url,{method:'PUT',headers:{'Content-Type':'image/png'},body:file});
      const check=await(await fetch('/result')).json();
      status.textContent=result.ok && check.verified?'Passed: browser supplied signed length and uploaded the exact file':'Failed: HTTP '+result.status;
    } catch(error) {status.textContent='Failed: '+error.message;}
  };
  </script></body></html>`);
});
server.listen(9060, '127.0.0.1', () =>
  console.info('Browser upload test at http://127.0.0.1:9060'),
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => {
      void storage.delete(key).finally(() => storage.close());
    });
  });
}
