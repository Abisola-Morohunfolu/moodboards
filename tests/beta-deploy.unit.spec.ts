import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function deploy(queryResult: string, queryExit = 0, dumpExit = 0) {
  const root = mkdtempSync(join(tmpdir(), 'moodboard-deploy-test-'));
  const log = join(root, 'docker.log');
  try {
    mkdirSync(join(root, 'scripts'));
    for (const script of ['beta-deploy.sh', 'beta-backup.sh']) {
      copyFileSync(resolve(__dirname, '../scripts', script), join(root, 'scripts', script));
    }
    writeFileSync(
      join(root, 'docker'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$REVIEW_DOCKER_LOG"
case "$*" in
  *' psql '*) printf '%s\\n' "$REVIEW_QUERY_RESULT"; exit "$REVIEW_QUERY_EXIT" ;;
  *' pg_dump '*) printf 'test backup\\n'; exit "$REVIEW_DUMP_EXIT" ;;
esac
`,
      { mode: 0o700 },
    );
    const result = spawnSync('bash', [join(root, 'scripts/beta-deploy.sh')], {
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH ?? ''}`,
        BETA_ENV_FILE: '.env.beta',
        REVIEW_DOCKER_LOG: log,
        REVIEW_QUERY_RESULT: queryResult,
        REVIEW_QUERY_EXIT: String(queryExit),
        REVIEW_DUMP_EXIT: String(dumpExit),
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.error) {
      throw result.error;
    }
    return { status: result.status, calls: readFileSync(log, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Private beta deployment backup gate', () => {
  it.each([
    { name: 'a failed query', result: '', exit: 2 },
    { name: 'a failed query that emits a result', result: 't', exit: 2 },
    { name: 'an unexpected query result', result: '', exit: 0 },
  ])('stops before backup, migrations, and rollout after $name', ({ result, exit }) => {
    const run = deploy(result, exit);
    expect(run.status).not.toBe(0);
    expect(run.calls).not.toContain('pg_dump');
    expect(run.calls).not.toContain('run --rm --no-deps migrate');
    expect(run.calls).not.toContain('up -d --wait api worker web proxy');
  });

  it('skips backup only after confirming a fresh database', () => {
    const run = deploy('f');
    expect(run.status).toBe(0);
    expect(run.calls).not.toContain('pg_dump');
    expect(run.calls).toContain('run --rm --no-deps migrate');
    expect(run.calls).toContain('up -d --wait api worker web proxy');
  });

  it('backs up an existing database before migrations', () => {
    const run = deploy('t');
    expect(run.status).toBe(0);
    expect(run.calls).toContain('pg_dump');
    expect(run.calls.indexOf('pg_dump')).toBeLessThan(
      run.calls.indexOf('run --rm --no-deps migrate'),
    );
    expect(run.calls).toContain('up -d --wait api worker web proxy');
  });

  it('stops before migrations and rollout when backup fails', () => {
    const run = deploy('t', 0, 1);
    expect(run.status).not.toBe(0);
    expect(run.calls).toContain('pg_dump');
    expect(run.calls).not.toContain('run --rm --no-deps migrate');
    expect(run.calls).not.toContain('up -d --wait api worker web proxy');
  });
});
