import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ContactPrincipal } from '../access/contact-access';

export const PUBLIC_ROUTE = 'moodboard:public';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const CONTACT_ROUTE = 'moodboard:contact';
export const ContactOnly = () => SetMetadata(CONTACT_ROUTE, true);
export const CurrentContact = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ContactPrincipal =>
    context.switchToHttp().getRequest().contactPrincipal,
);
export interface AuthPrincipal {
  userId: string;
  sessionHash: string;
}
export interface AuthRequest extends Request {
  principal: AuthPrincipal;
  contactPrincipal?: ContactPrincipal;
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    return context.switchToHttp().getRequest<AuthRequest>().principal;
  },
);
