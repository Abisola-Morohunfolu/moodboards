import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRequest, PUBLIC_ROUTE } from './auth.decorators';
import { readCookie, SESSION_COOKIE } from './cookies';
import { SessionRepository } from './session.repository';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionRepository,
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
    const token = readCookie(request, SESSION_COOKIE);
    const principal = token ? await this.sessions.resolve(token) : undefined;
    if (!principal) {
      throw new UnauthorizedException('Sign in required');
    }
    request.principal = principal;
    return true;
  }
}
