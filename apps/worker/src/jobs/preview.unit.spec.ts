import { EgressFetcher, publicAddress, InvalidMedia } from './egress';
import { parsePreview } from './preview-parser';
import { backoff, jobId } from '../queues/media';
import { maintenanceDay } from './maintenance';
describe('Preview egress and parsing', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '172.16.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('blocks non-public address %s', (value) => expect(publicAddress(value)).toBe(false));
  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public address %s',
    (value) => expect(publicAddress(value)).toBe(true),
  );
  it('rejects DNS answers containing any private address before connecting', async () => {
    const resolve = jest.fn().mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(new EgressFetcher(resolve).fetch('https://example.com')).rejects.toBeInstanceOf(
      InvalidMedia,
    );
    expect(resolve).toHaveBeenCalledWith('example.com');
  });
  it('extracts plain Open Graph fields and resolves images without fetching them', () => {
    expect(
      parsePreview(
        '<title>Fallback</title><meta property="og:title" content="&lt;b&gt;Hello&lt;/b&gt;"><meta property="og:image" content="/image.jpg"><meta name="description" content="Plain description">',
        'https://example.com/a',
      ),
    ).toEqual({
      title: 'Hello',
      description: 'Plain description',
      imageUrl: 'https://example.com/image.jpg',
      siteName: null,
    });
  });
  it('uses JSON-LD and ordinary title fallbacks, ignoring malformed scripts', () => {
    expect(
      parsePreview(
        '<script type="application/ld+json">bad</script><script type="application/ld+json">{"@type":"Product","name":"Lamp","description":"Nice","image":{"url":"/lamp.png"}}</script>',
        'https://example.com',
      ),
    ).toMatchObject({
      title: 'Lamp',
      description: 'Nice',
      imageUrl: 'https://example.com/lamp.png',
    });
    expect(
      parsePreview(
        '<title> Simple title </title><meta property="og:image" content="javascript:bad">',
        'https://example.com',
      ),
    ).toMatchObject({ title: 'Simple title', imageUrl: null });
  });
  it('bounds retry delay and gives each preview generation a stable distinct job ID', () => {
    expect(backoff(1)).toBe(1000);
    expect(backoff(10)).toBe(300000);
    const payload = { entityId: '00000000-0000-4000-8000-000000000001', generation: 'initial' };
    expect(jobId(payload)).not.toContain(':');
    expect(jobId(payload)).toBe(jobId({ ...payload }));
    expect(jobId({ ...payload, generation: 'later' })).not.toBe(jobId(payload));
  });
  it('falls back when higher-priority metadata contains empty or unsupported values', () => {
    expect(
      parsePreview(
        '<meta property="og:title" content=" "><meta property="og:description" content=""><title>Fallback</title><meta name="description" content="Description">',
        'https://example.com',
      ),
    ).toMatchObject({ title: 'Fallback', description: 'Description' });
  });
  it('schedules daily maintenance using UTC', () => {
    expect(maintenanceDay(new Date('2026-10-05T01:59:59Z'))).toBeNull();
    expect(maintenanceDay(new Date('2026-10-05T02:00:00Z'))).toBe('2026-10-05');
  });
});
