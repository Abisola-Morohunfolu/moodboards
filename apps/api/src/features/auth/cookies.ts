import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'moodboard_session';
export const FLOW_COOKIE = 'moodboard_google_flow';
export const CONTACT_COOKIE = 'moodboard_contact';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function readCookie(request: Request, name: string): string | undefined {
  const cookies = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
  const matches = cookies.filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) {
    return undefined;
  }
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function writeCookie(
  response: Response,
  name: string,
  token: string,
  production: boolean,
  seconds: number,
): void {
  response.cookie(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    path: name === FLOW_COOKIE ? '/auth/google' : name === CONTACT_COOKIE ? '/client' : '/',
    maxAge: seconds * 1000,
  });
}
export function clearCookie(response: Response, name: string, production: boolean): void {
  response.clearCookie(name, {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    path: name === FLOW_COOKIE ? '/auth/google' : name === CONTACT_COOKIE ? '/client' : '/',
  });
}
