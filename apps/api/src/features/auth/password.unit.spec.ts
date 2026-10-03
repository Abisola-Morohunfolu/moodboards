import { PasswordService } from './password.service';

describe('Password hashing', () => {
  const service = new PasswordService();
  it('uses random salts, preserves whitespace, and validates passwords', async () => {
    const password = '  correct horse battery staple  ';
    const first = await service.hash(password);
    expect(first).toMatch(/^scrypt-v1:32768:8:3:[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(await service.hash(password)).not.toBe(first);
    expect(await service.verify(password, first)).toBe(true);
    expect(await service.verify(password.trim(), first)).toBe(false);
  });
  it.each([null, 'bad', 'scrypt-v1:1:8:3:salt:key'])(
    'rejects missing or malformed credentials after dummy work',
    async (encoded) => {
      expect(await service.verify('some password', encoded)).toBe(false);
    },
  );
});
