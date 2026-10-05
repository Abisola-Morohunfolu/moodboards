import { randomUUID } from 'node:crypto';
import {
  createItemRequestSchema,
  normalizeLink,
  presignRequestSchema,
  assetUrlQuerySchema,
  itemResponseSchema,
  boardEventSchema,
} from './index';
describe('Media contracts', () => {
  const base = { id: randomUUID(), zOrder: 'a0' };
  it('accepts the three item variants and normalizes links without stripping queries', () => {
    expect(createItemRequestSchema.parse({ ...base, kind: 'note' }).kind).toBe('note');
    expect(
      createItemRequestSchema.parse({ ...base, kind: 'image', assetId: randomUUID() }).kind,
    ).toBe('image');
    expect(
      createItemRequestSchema.parse({
        ...base,
        kind: 'link',
        url: 'HTTPS://EXAMPLE.COM:443/a?q=1#here',
      }),
    ).toMatchObject({ url: 'https://example.com/a?q=1' });
  });
  it.each([
    'file:///tmp/x',
    'http://user:secret@example.com',
    'https://example.com:8443',
    'javascript:alert(1)',
  ])('rejects unsafe URL shape %s', (url) => {
    expect(() => normalizeLink(url)).toThrow();
    expect(createItemRequestSchema.safeParse({ ...base, kind: 'link', url }).success).toBe(false);
  });
  it('rejects foreign fields, mixed kinds, unsupported MIME, and invalid sizes', () => {
    expect(
      createItemRequestSchema.safeParse({ ...base, kind: 'note', assetId: randomUUID() }).success,
    ).toBe(false);
    expect(presignRequestSchema.safeParse({ mime: 'image/svg+xml', bytes: 20 }).success).toBe(
      false,
    );
    expect(presignRequestSchema.safeParse({ mime: 'image/png', bytes: 0 }).success).toBe(false);
    expect(assetUrlQuerySchema.parse({}).variant).toBe('original');
    expect(assetUrlQuerySchema.safeParse({ variant: 'raw' }).success).toBe(false);
  });
  it('validates system completion events and rejects secrets in their payloads', () => {
    expect(
      boardEventSchema.parse({ type: 'asset.ready', payload: { assetId: base.id } }).type,
    ).toBe('asset.ready');
    expect(
      boardEventSchema.safeParse({
        type: 'preview.ready',
        payload: { previewId: base.id, url: 'secret' },
      }).success,
    ).toBe(false);
    expect(itemResponseSchema.safeParse({ kind: 'image', storageKey: 'secret' }).success).toBe(
      false,
    );
  });
});
