import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { normalizeLink } from '@moodboard/contracts';
import { deadline } from '../queues/media';
export class InvalidMedia extends Error {}
export function publicAddress(value: string): boolean {
  try {
    const address = ipaddr.parse(value);
    if (address.kind() === 'ipv6' && (address as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (address as ipaddr.IPv6).toIPv4Address().range() === 'unicast';
    }
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}
export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export interface Page {
  html: string;
  url: string;
}
export interface PageFetcher {
  fetch(url: string): Promise<Page>;
}
const maxBytes = 2 * 1024 * 1024;
export class EgressFetcher implements PageFetcher {
  constructor(private readonly resolve: Resolver = (hostname) => lookup(hostname, { all: true })) {}
  async fetch(input: string): Promise<Page> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const end = Date.now() + 5000;
    try {
      let url = normalizeLink(input);
      for (let redirects = 0; redirects <= 3; redirects++) {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^\[|\]$/g, '');
        const addresses = ipaddr.isValid(host)
          ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }]
          : await deadline(this.resolve(host), Math.max(1, end - Date.now()));
        if (!addresses.length || addresses.some((address) => !publicAddress(address.address))) {
          throw new InvalidMedia('Preview address blocked');
        }
        if (controller.signal.aborted) {
          throw new Error('Preview timeout');
        }
        const result = await this.request(parsed, addresses[0]!, controller.signal);
        if (result.redirect) {
          if (redirects === 3) {
            throw new InvalidMedia('Too many redirects');
          }
          try {
            url = normalizeLink(new URL(result.redirect, url).href);
          } catch {
            throw new InvalidMedia('Invalid redirect');
          }
          continue;
        }
        return { html: result.html!, url };
      }
      throw new InvalidMedia('Too many redirects');
    } finally {
      clearTimeout(timer);
    }
  }
  private request(
    url: URL,
    address: { address: string; family: number },
    signal: AbortSignal,
  ): Promise<{ html?: string; redirect?: string }> {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          agent: false,
          signal,
          family: address.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          headers: {
            'User-Agent': 'MoodboardPreview/1.0',
            Accept: 'text/html, application/xhtml+xml',
            'Accept-Encoding': 'gzip, deflate, br',
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const redirect = response.headers.location;
            response.destroy();
            if (!redirect) {
              reject(new InvalidMedia('Redirect missing location'));
            } else {
              resolve({ redirect });
            }
            return;
          }
          if (status < 200 || status >= 300) {
            response.destroy();
            reject(
              status >= 500 || status === 429
                ? new Error('Preview temporarily unavailable')
                : new InvalidMedia('Preview HTTP failure'),
            );
            return;
          }
          if (
            !/^text\/html|^application\/xhtml\+xml/i.test(response.headers['content-type'] ?? '')
          ) {
            response.destroy();
            reject(new InvalidMedia('Preview is not HTML'));
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              response.destroy(new InvalidMedia('Preview exceeds byte limit'));
            } else {
              chunks.push(chunk);
            }
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              let body = Buffer.concat(chunks);
              const encoding = response.headers['content-encoding'];
              if (encoding === 'gzip') {
                body = gunzipSync(body, { maxOutputLength: maxBytes });
              } else if (encoding === 'deflate') {
                body = inflateSync(body, { maxOutputLength: maxBytes });
              } else if (encoding === 'br') {
                body = brotliDecompressSync(body, { maxOutputLength: maxBytes });
              } else if (encoding && encoding !== 'identity') {
                throw new InvalidMedia('Unsupported encoding');
              }
              if (body.length > maxBytes) {
                throw new InvalidMedia('Preview exceeds byte limit');
              }
              resolve({ html: body.toString('utf8') });
            } catch {
              reject(new InvalidMedia('Invalid or oversized preview body'));
            }
          });
        },
      );
      request.on('error', reject);
      request.end();
    });
  }
}
