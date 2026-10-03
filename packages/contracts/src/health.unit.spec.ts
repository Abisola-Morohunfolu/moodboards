import { liveResponseSchema, readyResponseSchema } from './index';

describe('Health response schemas', () => {
  it('accepts live and ready responses', () => {
    expect(liveResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(
      readyResponseSchema.safeParse({ status: 'ok', checks: { postgres: 'ok', migrations: 'ok' } })
        .success,
    ).toBe(true);
  });
  it('rejects extra details and an inconsistent status', () => {
    expect(liveResponseSchema.safeParse({ status: 'ok', credentials: 'secret' }).success).toBe(
      false,
    );
    expect(
      readyResponseSchema.safeParse({
        status: 'ok',
        checks: { postgres: 'down', migrations: 'ok' },
      }).success,
    ).toBe(false);
  });
});
