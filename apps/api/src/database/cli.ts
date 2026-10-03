import { resolve } from 'node:path';
import { config } from 'dotenv';
import { apiDataSource } from './data-source';
import { migrationsApplied } from './migration-status';

async function main(): Promise<void> {
  config({ path: resolve(__dirname, '../../../../.env'), quiet: true });
  const command = process.argv[2];
  if (!['run', 'status', 'revert'].includes(command ?? '')) {
    throw new Error('Invalid migration command');
  }
  if (command === 'revert') {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.pathname !== '/moodboard_test') {
      throw new Error('Revert requires the disposable moodboard_test database');
    }
  }
  const source = apiDataSource(process.env);
  try {
    await source.initialize();
    if (command === 'run') {
      const applied = await source.runMigrations();
      console.log(`Applied ${applied.length} migration(s)`);
    } else if (command === 'revert') {
      await source.undoLastMigration();
      console.log('Reverted last migration');
    } else {
      const ready = await migrationsApplied(source);
      console.log(ready ? 'All migrations are applied' : 'Database requires migrations');
      if (!ready) {
        process.exitCode = 1;
      }
    }
  } finally {
    if (source.isInitialized) {
      await source.destroy();
    }
  }
}

void main().catch(() => {
  console.error(
    'Migration command failed. Check configuration, database access, and schema state.',
  );
  process.exitCode = 1;
});
