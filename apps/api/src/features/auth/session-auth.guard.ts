import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRequest, PUBLIC_ROUTE, CONTACT_ROUTE } from './auth.decorators';
import { readCookie, SESSION_COOKIE, CONTACT_COOKIE } from './cookies';
import { SessionRepository } from './session.repository';
import { ContactSessionRepository } from '../access/contact-session.repository';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionRepository,
    private readonly contacts: ContactSessionRepository,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (
      this.reflector.getAllAndOverride<boolean>(CONTACT_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      const token = readCookie(request, CONTACT_COOKIE);
      const principal = token ? await this.contacts.resolve(token) : undefined;
      if (!principal) {
        throw new UnauthorizedException('Client session required');
      }
      request.contactPrincipal = principal;
      return true;
    }
    const token = readCookie(request, SESSION_COOKIE);
    const principal = token ? await this.sessions.resolve(token) : undefined;
    if (!principal) {
      throw new UnauthorizedException('Sign in required');
    }
    request.principal = principal;
    return true;
  }
}
