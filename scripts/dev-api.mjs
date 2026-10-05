import { spawn } from 'node:child_process';
import console from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) {
    return;
  }
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

function start(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => {
    console.error('API development process failed');
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      stop(code ?? 1);
    }
  });
}

for (const path of ['packages/contracts', 'packages/database', 'packages/storage', 'apps/api']) {
  start([
    resolve(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    `${path}/tsconfig.build.json`,
    '--watch',
    '--preserveWatchOutput',
  ]);
}
start(['--watch', 'apps/api/dist/main.js']);
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
