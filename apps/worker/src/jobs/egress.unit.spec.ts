import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { EgressFetcher, InvalidMedia } from './egress';
describe('Pinned preview HTTP requests', () => {
  let spy: jest.SpyInstance;
  const options: http.RequestOptions[] = [];
  beforeEach(() => {
    options.length = 0;
    spy = jest.spyOn(http, 'request');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  function reply(
    status: number,
    headers: Record<string, string>,
    body = Buffer.from('<title>Fixture</title>'),
  ) {
    spy.mockImplementationOnce(
      (
        _url: URL,
        opts: http.RequestOptions,
        callback: (response: http.IncomingMessage) => void,
      ) => {
        options.push(opts);
        const req = new EventEmitter() as http.ClientRequest;
        req.end = (() => {
          queueMicrotask(() => {
            const response = new PassThrough() as unknown as http.IncomingMessage;
            response.statusCode = status;
            response.headers = headers;
            callback(response);
            response.push(body);
            response.push(null);
          });
          return req;
        }) as typeof req.end;
        opts.signal?.addEventListener(
          'abort',
          () => req.emit('error', new Error('Fixture abort')),
          { once: true },
        );
        return req;
      },
    );
  }
  const resolver = () => jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  it('pins the socket lookup to the validated address without a second DNS lookup', async () => {
    reply(200, { 'content-type': 'text/html' });
    const dns = resolver();
    const page = await new EgressFetcher(dns).fetch('http://example.com');
    expect(page.html).toContain('Fixture');
    expect(dns).toHaveBeenCalledTimes(1);
    const callback = jest.fn();
    Reflect.apply(options[0]!.lookup!, null, ['example.com', {}, callback]);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(options[0]!.agent).toBe(false);
  });
  it('checks redirect DNS and rejects a redirect into a private address', async () => {
    reply(302, { location: 'http://internal.example/path' });
    const dns = resolver()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(new EgressFetcher(dns).fetch('http://example.com')).rejects.toBeInstanceOf(
      InvalidMedia,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('allows at most three redirects', async () => {
    for (let i = 0; i < 4; i++) {
      reply(302, { location: `http://example.com/${i}` });
    }
    await expect(new EgressFetcher(resolver()).fetch('http://example.com')).rejects.toThrow(
      'Too many redirects',
    );
    expect(spy).toHaveBeenCalledTimes(4);
  });
  it.each([false, true])(
    'caps both encoded and decoded bodies (compressed=%s)',
    async (compressed) => {
      const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 65);
      reply(
        200,
        { 'content-type': 'text/html', ...(compressed ? { 'content-encoding': 'gzip' } : {}) },
        compressed ? gzipSync(oversized) : oversized,
      );
      await expect(
        new EgressFetcher(resolver()).fetch('http://example.com'),
      ).rejects.toBeInstanceOf(InvalidMedia);
    },
  );
  it('enforces the total deadline on a stalled HTTP response', async () => {
    jest.useFakeTimers();
    spy.mockImplementationOnce((_url: URL, opts: http.RequestOptions) => {
      const req = new EventEmitter() as http.ClientRequest;
      req.end = (() => req) as typeof req.end;
      opts.signal?.addEventListener('abort', () => req.emit('error', new Error('Fixture abort')));
      return req;
    });
    const pending = expect(
      new EgressFetcher(resolver()).fetch('http://example.com'),
    ).rejects.toThrow('abort');
    await jest.advanceTimersByTimeAsync(5000);
    await pending;
  });
});
