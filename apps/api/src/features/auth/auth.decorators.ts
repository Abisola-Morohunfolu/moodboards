import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const PUBLIC_ROUTE = 'moodboard:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export interface AuthPrincipal {
  userId: string;
  sessionHash: string;
}
export interface AuthRequest extends Request {
  principal: AuthPrincipal;
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    return context.switchToHttp().getRequest<AuthRequest>().principal;
  },
);
