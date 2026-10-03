import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReadyResponse } from '@moodboard/contracts';
import { migrationsApplied } from '../../database/migration-status';

const unavailable: ReadyResponse = {
  status: 'down',
  checks: { postgres: 'down', migrations: 'down' },
};

interface PostgresConnection {
  end(): Promise<void>;
}

@Injectable()
export class HealthService {
  constructor(private readonly source: DataSource) {}

  async ready(): Promise<ReadyResponse> {
    if (!this.source.isInitialized) {
      return unavailable;
    }

    const runner = this.source.createQueryRunner();
    let connection: PostgresConnection | undefined;
    let expired = false;
    let timer: NodeJS.Timeout | undefined;

    const checkDatabase = async (): Promise<ReadyResponse> => {
      try {
        connection = await runner.connect();
        // Acquisition can finish after the response deadline. Return this unused
        // connection without starting queries or leaving it checked out.
        if (expired) {
          return unavailable;
        }
        await runner.query('select 1');
        if (expired) {
          return unavailable;
        }

        let migrated = false;
        try {
          migrated = await migrationsApplied(this.source, runner);
        } catch {
          /* Do not expose database errors. */
        }
        return expired
          ? unavailable
          : {
              status: migrated ? 'ok' : 'down',
              checks: { postgres: 'ok', migrations: migrated ? 'ok' : 'down' },
            };
      } catch {
        return unavailable;
      } finally {
        await runner.release();
      }
    };

    try {
      return await Promise.race([
        checkDatabase(),
        new Promise<ReadyResponse>((resolve) => {
          timer = setTimeout(() => {
            expired = true;
            // pg closes the socket when end() interrupts an active query. The
            // pool discards the closed client instead of reusing a stalled one.
            void connection?.end().catch(() => undefined);
            resolve(unavailable);
          }, 2000);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
