import { once } from 'node:events';
import { connect, createServer, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { RateLimitService } from '../apps/api/src/features/auth/rate-limit.service';
import { testRateLimitStore, testRedisUrl } from './redis';

it('bounds a stalled Redis command and recovers using a replacement connection', async () => {
  const target = new URL(testRedisUrl());
  const sockets = new Set<Socket>();
  let stall = false;
  let connections = 0;
  const proxy = createServer((downstream) => {
    connections++;
    const upstream = connect(Number(target.port || 6379), target.hostname);
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
    }
    downstream.on('close', () => upstream.destroy());
    upstream.on('close', () => downstream.destroy());
    downstream.on('data', (bytes: Buffer) => {
      if (!stall) {
        upstream.write(bytes);
      }
    });
    upstream.pipe(downstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') {
    throw new Error('Proxy did not listen on a TCP port');
  }
  const proxyUrl = new URL(target);
  proxyUrl.hostname = '127.0.0.1';
  proxyUrl.port = String(address.port);
  const store = testRateLimitStore(proxyUrl.toString());
  const limits = new RateLimitService(store);
  const response = { setHeader: jest.fn() } as unknown as Parameters<
    RateLimitService['enforce']
  >[3];
  const ip = randomUUID();
  try {
    await store.client.connect();
    await limits.enforce('timeout-test', ip, 10, response);
    stall = true;
    const started = Date.now();
    await expect(limits.enforce('timeout-test', ip, 10, response)).rejects.toMatchObject({
      status: 503,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(response.setHeader).not.toHaveBeenCalled();
    stall = false;
    if (!store.client.isReady) {
      await once(store.client, 'ready', { signal: AbortSignal.timeout(3000) });
    }
    await expect(limits.enforce('timeout-test', ip, 10, response)).resolves.toBeUndefined();
    expect(connections).toBe(2);
  } finally {
    store.onApplicationShutdown();
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

it.each(['startup', 'reconnection'])(
  'recovers automatically from a stalled Redis handshake during %s',
  async (phase) => {
    const target = new URL(testRedisUrl());
    const sockets = new Set<Socket>();
    let connections = 0;
    const stalledConnection = phase === 'startup' ? 1 : 2;
    const proxy = createServer((downstream) => {
      const number = ++connections;
      const upstream = connect(Number(target.port || 6379), target.hostname);
      for (const socket of [downstream, upstream]) {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
      }
      downstream.on('close', () => upstream.destroy());
      upstream.on('close', () => downstream.destroy());
      downstream.on('data', (bytes: Buffer) => {
        if (number !== stalledConnection) {
          upstream.write(bytes);
        }
      });
      upstream.pipe(downstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') {
      throw new Error('Proxy did not listen on a TCP port');
    }
    const proxyUrl = new URL(target);
    proxyUrl.hostname = '127.0.0.1';
    proxyUrl.port = String(address.port);
    const store = testRateLimitStore(proxyUrl.toString());
    const key = `handshake-test:${randomUUID()}`;
    // Redis emits expected connection errors during recovery; observe readiness
    // without letting EventEmitter.once reject on those intermediate errors.
    const nextReady = () => new Promise<void>((resolve) => store.client.once('ready', resolve));
    const waitForReady = async (ready: Promise<void>) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Redis handshake did not recover')), 4000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const firstReady = nextReady();
      store.onModuleInit();
      if (phase === 'startup') {
        await once(store.client, 'connect');
        await expect(store.increment(key)).rejects.toThrow();
      } else {
        await waitForReady(firstReady);
        const reconnected = nextReady();
        const nextConnect = new Promise<void>((resolve) => store.client.once('connect', resolve));
        for (const socket of sockets) {
          socket.destroy();
        }
        await nextConnect;
        await expect(store.increment(key)).rejects.toThrow();
        await waitForReady(reconnected);
      }
      await waitForReady(firstReady);
      expect(await store.increment(key)).toMatchObject({ count: 1 });
      expect(connections).toBe(stalledConnection + 1);
      // Healthy idle sockets must survive longer than the socket timeout.
      await delay(1200);
      expect(store.client.isReady).toBe(true);
      expect(connections).toBe(stalledConnection + 1);
      await store.client.del(key);
    } finally {
      store.onApplicationShutdown();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  },
);
