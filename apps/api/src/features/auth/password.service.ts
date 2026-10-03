import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const prefix = 'scrypt-v1:32768:8:3';
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `${prefix}:${salt.toString('hex')}:${key.toString('hex')}`;
  }
  async verify(password: string, encoded: string | null): Promise<boolean> {
    const parts = encoded?.split(':');
    const valid =
      parts?.length === 6 &&
      parts.slice(0, 4).join(':') === prefix &&
      /^[a-f0-9]{32}$/.test(parts[4] ?? '') &&
      /^[a-f0-9]{128}$/.test(parts[5] ?? '');
    // Missing or malformed credentials still perform the same expensive derivation.
    const salt = valid ? Buffer.from(parts[4]!, 'hex') : Buffer.alloc(16);
    const expected = valid ? Buffer.from(parts[5]!, 'hex') : Buffer.alloc(64);
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected) && Boolean(valid);
  }
}
