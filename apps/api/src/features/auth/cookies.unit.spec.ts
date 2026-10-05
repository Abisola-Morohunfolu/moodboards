import type { Request, Response } from 'express';
import {
  clearCookie,
  FLOW_COOKIE,
  CONTACT_COOKIE,
  randomToken,
  readCookie,
  SESSION_COOKIE,
  writeCookie,
} from './cookies';

describe('Authentication cookies', () => {
  it('rejects duplicate or malformed cookies', () => {
    const token = randomToken();
    const request = (cookie: string) => ({ headers: { cookie } }) as Request;
    expect(readCookie(request(`${SESSION_COOKIE}=${token}`), SESSION_COOKIE)).toBe(token);
    expect(
      readCookie(request(`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`), SESSION_COOKIE),
    ).toBeUndefined();
    expect(readCookie(request(`${SESSION_COOKIE}=bad`), SESSION_COOKIE)).toBeUndefined();
  });
  it('sets and clears production cookies with the same scope', () => {
    const cookie = jest.fn();
    const clear = jest.fn();
    const response = { cookie, clearCookie: clear } as unknown as Response;
    writeCookie(response, SESSION_COOKIE, 'value', true, 604800);
    expect(cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'value', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 604800000,
    });
    clearCookie(response, SESSION_COOKIE, true);
    expect(clear).toHaveBeenCalledWith(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
    writeCookie(response, FLOW_COOKIE, 'value', true, 600);
    expect(cookie).toHaveBeenLastCalledWith(
      FLOW_COOKIE,
      'value',
      expect.objectContaining({ path: '/auth/google', maxAge: 600000 }),
    );
    writeCookie(response, CONTACT_COOKIE, 'value', true, 604800);
    expect(cookie).toHaveBeenLastCalledWith(
      CONTACT_COOKIE,
      'value',
      expect.objectContaining({ path: '/client', secure: true, httpOnly: true, sameSite: 'lax' }),
    );
    clearCookie(response, CONTACT_COOKIE, true);
    expect(clear).toHaveBeenLastCalledWith(
      CONTACT_COOKIE,
      expect.objectContaining({ path: '/client', secure: true }),
    );
  });
});
