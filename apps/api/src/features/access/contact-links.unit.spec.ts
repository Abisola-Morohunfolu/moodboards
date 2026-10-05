import { randomUUID } from 'node:crypto';
import { contactSignature, validContactSignature } from './contact-links';
describe('Board-specific contact signatures', () => {
  const secret = 'a'.repeat(64);
  const id = randomUUID();
  it('binds a signature to its participant, generation, and signing secret', () => {
    const signature = contactSignature(secret, id, 1);
    expect(validContactSignature(secret, id, 1, signature)).toBe(true);
    expect(validContactSignature(secret, randomUUID(), 1, signature)).toBe(false);
    expect(validContactSignature(secret, id, 2, signature)).toBe(false);
    expect(validContactSignature('b'.repeat(64), id, 1, signature)).toBe(false);
    expect(validContactSignature(secret, id, 1, signature.slice(0, -1))).toBe(false);
    expect(validContactSignature(secret, id, 1, `${signature}=`)).toBe(false);
  });
});
