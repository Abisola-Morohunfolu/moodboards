import { serve } from 'srvx';
import { staticMiddleware } from 'srvx/static';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import handler from './dist/server/server.js';

const port = Number(process.env.WEB_PORT ?? process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid WEB_PORT');
}
// No access-log middleware: share tokens must never enter request logs.
serve({
  hostname: process.env.WEB_HOST ?? process.env.HOST ?? '127.0.0.1',
  port,
  gracefulShutdown: true,
  middleware: [staticMiddleware({ dir: fileURLToPath(new URL('./dist/client', import.meta.url)) })],
  fetch: (request) => handler.fetch(request),
});
