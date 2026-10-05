import { load } from 'cheerio';
export interface PreviewMetadata {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}
export function parsePreview(html: string, url: string): PreviewMetadata {
  const $ = load(html);
  const plain = (value: unknown, limit = 1000): string | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const text = load(value).text().replace(/\s+/g, ' ').trim().slice(0, limit);
    return text || null;
  };
  const firstText = (values: unknown[], limit: number) => {
    for (const value of values) {
      const text = plain(value, limit);
      if (text) {
        return text;
      }
    }
    return null;
  };
  const meta = (name: string) =>
    $(`meta[property="${name}"],meta[name="${name}"]`).first().attr('content');
  let structured: Record<string, unknown> = {};
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const value: unknown = JSON.parse($(script).text());
      const objects = Array.isArray(value) ? value : [value];
      for (const object of objects) {
        if (object && typeof object === 'object') {
          const record = object as Record<string, unknown>;
          const candidates = Array.isArray(record['@graph']) ? record['@graph'] : [record];
          for (const candidate of candidates) {
            if (
              candidate &&
              typeof candidate === 'object' &&
              ['Product', 'Article', 'WebPage', 'Restaurant', 'LocalBusiness', 'Event'].includes(
                String((candidate as Record<string, unknown>)['@type']),
              )
            ) {
              structured = candidate as Record<string, unknown>;
              break;
            }
          }
        }
      }
    } catch {
      /* Malformed metadata falls back to ordinary HTML. */
    }
  }
  let image: unknown = meta('og:image') ?? structured.image;
  if (Array.isArray(image)) {
    image = image[0];
  }
  if (image && typeof image === 'object') {
    image = (image as Record<string, unknown>).url;
  }
  let imageUrl: string | null = null;
  if (typeof image === 'string') {
    try {
      const resolved = new URL(image, url);
      if (
        ['http:', 'https:'].includes(resolved.protocol) &&
        !resolved.username &&
        !resolved.password
      ) {
        imageUrl = resolved.href.slice(0, 8192);
      }
    } catch {
      /* Invalid metadata images are omitted. */
    }
  }
  return {
    title: firstText(
      [meta('og:title'), structured.name, structured.headline, $('title').first().text()],
      200,
    ),
    description: firstText(
      [meta('og:description'), structured.description, meta('description')],
      2000,
    ),
    imageUrl,
    siteName: plain(meta('og:site_name'), 200),
  };
}
