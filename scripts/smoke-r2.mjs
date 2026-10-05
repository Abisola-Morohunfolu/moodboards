import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import process from 'node:process';
import sharp from 'sharp';
import { R2Storage, r2Config } from '../packages/storage/dist/index.js';
import { createDataSource } from '../packages/database/dist/index.js';
import { accountResponseSchema, presignResponseSchema } from '../packages/contracts/dist/index.js';
import { MediaProcessors } from '../apps/worker/dist/jobs/processors.js';

const { fetch, AbortSignal } = globalThis;
const config = r2Config(process.env);
if (!config || !process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
  throw new Error('R2 smoke requires complete R2 credentials and a development DATABASE_URL');
}
const port = Number(process.env.R2_SMOKE_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid R2_SMOKE_PORT');
}
const origin = `http://127.0.0.1:${port}`;
const api = `http://127.0.0.1:${Number(process.env.API_PORT ?? 3001)}`;
const storage = new R2Storage(config);
const source = createDataSource({ url: process.env.DATABASE_URL });
const processors = new MediaProcessors(source, storage);
const image = await sharp({
  create: { width: 640, height: 320, channels: 3, background: '#123456' },
})
  .png()
  .toBuffer();
const email = `r2-smoke-${randomUUID()}@example.invalid`;
let cookie;
let userId;
let workspaceId;
let boardId;
let assetId;
let used = false;
let stopping = false;
let active = Promise.resolve();

async function apiRequest(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  const session = response.headers.getSetCookie()[0];
  if (session) {
    cookie = session.split(';')[0];
  }
  return response.json();
}
function verify(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
async function reserve() {
  verify(!used, 'Restart the harness to run another check');
  used = true;
  await storage.ready();
  await source.initialize();
  const account = accountResponseSchema.parse(
    await apiRequest('/auth/signup', {
      email,
      password: randomUUID() + randomUUID(),
      displayName: 'Temporary R2 smoke check',
    }),
  );
  userId = account.user.id;
  workspaceId = account.workspaces[0]?.id;
  verify(workspaceId, 'Missing temporary workspace');
  const board = await apiRequest('/boards', { workspaceId, title: 'Temporary R2 smoke check' });
  boardId = board.id;
  const signed = presignResponseSchema.parse(
    await apiRequest(`/boards/${boardId}/assets/presign`, {
      mime: 'image/png',
      bytes: image.length,
    }),
  );
  assetId = signed.assetId;
  return { url: signed.url, mime: 'image/png', bytes: [...image] };
}
async function check() {
  verify(assetId && boardId, 'Reserve an upload first');
  const [staging] = await source.query(
    'select storage_key from assets where id=$1 and board_id=$2',
    [assetId, boardId],
  );
  verify(staging, 'Missing temporary asset');
  const info = await storage.head(staging.storage_key);
  verify(info?.mime === 'image/png' && info.bytes === image.length, 'Upload MIME or size mismatch');
  await apiRequest(`/boards/${boardId}/items`, {
    id: randomUUID(),
    kind: 'image',
    assetId,
    zOrder: 'a0',
  });
  // Exercise the actual worker image processor synchronously, without requiring a queue runner.
  await processors.image({ entityId: assetId, generation: 'initial' });
  const [asset] = await source.query('select * from assets where id=$1 and board_id=$2', [
    assetId,
    boardId,
  ]);
  verify(asset?.status === 'ready' && asset.thumbnail_key, 'Image processing did not finish');
  for (const [variant, key, mime] of [
    ['original', asset.storage_key, 'image/png'],
    ['thumbnail', asset.thumbnail_key, 'image/webp'],
  ]) {
    const signed = await apiRequest(`/assets/${assetId}/url?variant=${variant}`);
    const downloaded = await fetch(signed.url, { signal: AbortSignal.timeout(10000) });
    verify(
      downloaded.ok && downloaded.headers.get('content-type') === mime,
      'Signed download failed',
    );
    const body = Buffer.from(await downloaded.arrayBuffer());
    if (variant === 'original') {
      verify(body.equals(image), 'Original bytes changed');
    } else {
      const thumbnail = await sharp(body).metadata();
      verify(
        thumbnail.format === 'webp' && thumbnail.width === 512 && thumbnail.height === 256,
        'Invalid thumbnail',
      );
    }
    const unsigned = new URL(signed.url);
    unsigned.search = '';
    const denied = await fetch(unsigned, { signal: AbortSignal.timeout(10000) });
    verify([401, 403].includes(denied.status), 'Bucket allowed unsigned reads');
    let found = false;
    for await (const object of storage.objects(`media/${boardId}/${assetId}/`)) {
      found ||= object.key === key;
    }
    verify(found, 'Processed object missing from listing');
  }
}
async function cleanup() {
  if (!source.isInitialized) {
    return;
  }
  // Recover IDs even if signup succeeded but its HTTP response was interrupted.
  const [user] = await source.query('select id from users where email=$1', [email]);
  if (!user) {
    return;
  }
  userId = user.id;
  const workspaces = await source.query(
    'select workspace_id as id from workspace_members where user_id=$1',
    [userId],
  );
  const keys = new Set();
  const boards = await source.query('select id from boards where created_by=$1', [userId]);
  for (const board of boards) {
    for (const prefix of [`staging/${board.id}/`, `media/${board.id}/`]) {
      for await (const object of storage.objects(prefix)) {
        keys.add(object.key);
      }
    }
  }
  for (const key of keys) {
    await storage.delete(key);
    verify((await storage.head(key)) === null, 'Temporary object deletion failed');
  }
  await source.transaction(async (manager) => {
    for (const workspace of workspaces) {
      await manager.query(
        'delete from workspaces where id=$1 and not exists (select 1 from workspace_members where workspace_id=$1 and user_id<>$2)',
        [workspace.id, userId],
      );
    }
    await manager.query('delete from users where id=$1 and email=$2', [userId, email]);
  });
}
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><title>R2 smoke check</title></head><body><h1>R2 smoke check</h1><p>Uploads a temporary image, runs the worker image processor, and cleans up its data.</p><button id="run">Run R2 smoke check</button><p id="status">Ready</p><script>
    const button=document.querySelector('#run');
    const status=document.querySelector('#status');
    const post=async(path)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
    button.onclick=async()=>{button.disabled=true;status.textContent='Uploading and processing';try{const upload=await post('/reservation');const response=await fetch(upload.url,{method:'PUT',headers:{'Content-Type':upload.mime},body:new Blob([new Uint8Array(upload.bytes)],{type:upload.mime})});if(!response.ok)throw new Error('Browser upload failed: HTTP '+response.status);await post('/check');status.textContent='Passed: browser upload, image processing, thumbnail, signed downloads, privacy, listing, deletion and cleanup';}catch(error){status.textContent='Failed: '+error.message;try{await post('/cleanup');}catch{status.textContent+='; cleanup failed, check terminal';}}};
    </script></body></html>`);
    return;
  }
  if (
    request.method !== 'POST' ||
    request.headers.origin !== origin ||
    !['/reservation', '/check', '/cleanup'].includes(request.url)
  ) {
    response.writeHead(403).end();
    return;
  }
  const path = request.url;
  active = active.then(async () => {
    response.setHeader('Content-Type', 'application/json');
    try {
      if (path === '/reservation') {
        response.end(JSON.stringify(await reserve()));
        return;
      }
      if (path === '/check') {
        await check();
      }
      await cleanup();
      console.info(
        path === '/check'
          ? 'R2 smoke check passed; temporary data removed'
          : 'Temporary data removed',
      );
      response.end(JSON.stringify({ verified: true }));
    } catch {
      console.error(
        `R2 smoke check failed at ${path}; check credentials, API, database and bucket CORS`,
      );
      response.writeHead(503).end(
        JSON.stringify({
          error: 'Check terminal and services; temporary data cleanup will be attempted',
        }),
      );
    }
  });
});
server.listen(port, '127.0.0.1', () => console.info(`R2 smoke check at ${origin}`));
async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  server.close();
  await active;
  try {
    await cleanup();
  } catch {
    console.error('Temporary R2 smoke data cleanup failed; check bucket and database');
    process.exitCode = 1;
  } finally {
    storage.close();
    if (source.isInitialized) {
      await source.destroy();
    }
  }
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
