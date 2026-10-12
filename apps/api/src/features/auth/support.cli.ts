import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';
import { apiDataSource } from '../../database/data-source';
import { PasswordService } from './password.service';

async function main(): Promise<void> {
  config({ path: resolve(__dirname, '../../../../../.env'), quiet: true });
  const [command, rawEmail, verified] = process.argv.slice(2);
  if (
    command !== 'reset-password' ||
    verified !== '--identity-verified' ||
    process.argv.length !== 5
  ) {
    throw new Error(
      'Usage: support.cli.js reset-password EMAIL --identity-verified; password via stdin',
    );
  }
  const email = z.email().parse(rawEmail).trim().toLowerCase();
  process.stdin.setEncoding('utf8');
  let password = '';
  for await (const chunk of process.stdin) {
    password += String(chunk);
    if (password.length > 130) {
      throw new Error('Invalid password');
    }
  }
  password = password.replace(/\r?\n$/, '');
  z.string().min(15).max(128).parse(password);
  const hash = await new PasswordService().hash(password);
  const source = apiDataSource({ DATABASE_URL: process.env.DATABASE_URL, DB_POOL_MAX: 1 });
  try {
    await source.initialize();
    await source.transaction(async (manager) => {
      const users = await manager.query(
        'select id from users where email = $1 and deleted_at is null and password_hash is not null for update',
        [email],
      );
      if (users.length !== 1) {
        throw new Error('Account cannot be recovered with a password');
      }
      await manager.query('update users set password_hash = $1 where id = $2', [hash, users[0].id]);
      await manager.query('delete from auth_sessions where user_id = $1', [users[0].id]);
    });
    console.info('Password replaced and all account sessions revoked.');
  } finally {
    if (source.isInitialized) {
      await source.destroy();
    }
  }
}
void main().catch((error: unknown) => {
  if (error instanceof Error && error.message.startsWith('Invalid API configuration:')) {
    console.error(error.message);
  }
  console.error(
    'Recovery failed. Check verified identity, input, configuration, and account state.',
  );
  process.exitCode = 1;
});
