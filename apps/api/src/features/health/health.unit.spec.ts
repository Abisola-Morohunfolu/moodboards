import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('Readiness deadline and failures', () => {
  const query = jest.fn();
  const connect = jest.fn();
  const release = jest.fn();
  const end = jest.fn();
  let service: HealthService;
  beforeEach(async () => {
    query.mockReset();
    connect.mockReset().mockResolvedValue({ end });
    release.mockReset().mockResolvedValue(undefined);
    end.mockReset().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DataSource,
          useValue: {
            isInitialized: true,
            createQueryRunner: () => ({ connect, query, release }),
            migrations: [],
          },
        },
      ],
    }).compile();
    service = module.get(HealthService);
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it('returns a safe result on a database error', async () => {
    query.mockRejectedValue(new Error('postgres://user:secret@host/database'));
    expect(await service.ready()).toEqual({
      status: 'down',
      checks: { postgres: 'down', migrations: 'down' },
    });
  });
  it('keeps the database check successful when the history query fails', async () => {
    query
      .mockResolvedValueOnce([{ '?column?': 1 }])
      .mockRejectedValueOnce(new Error('Permission denied'));
    expect(await service.ready()).toEqual({
      status: 'down',
      checks: { postgres: 'ok', migrations: 'down' },
    });
  });
  it('ends the check after two seconds even if the pool cannot supply a connection', async () => {
    jest.useFakeTimers();
    let finish: (value: unknown) => void = () => {
      throw new Error('Query not started');
    };
    connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const response = service.ready();
    await jest.advanceTimersByTimeAsync(2000);
    expect(await response).toEqual({
      status: 'down',
      checks: { postgres: 'down', migrations: 'down' },
    });
    finish({ end });
    await jest.advanceTimersByTimeAsync(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });
  it('closes a stalled connection and releases its runner at the deadline', async () => {
    jest.useFakeTimers();
    query.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          end.mockImplementationOnce(() => {
            reject(new Error('Connection terminated'));
            return Promise.resolve();
          });
        }),
    );
    const response = service.ready();
    await jest.advanceTimersByTimeAsync(2000);
    expect(await response).toEqual({
      status: 'down',
      checks: { postgres: 'down', migrations: 'down' },
    });
    expect(end).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
