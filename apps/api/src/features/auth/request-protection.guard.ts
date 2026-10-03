import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ApiConfig } from '../../config';

@Injectable()
export class RequestProtectionGuard implements CanActivate {
  constructor(private readonly config: ConfigService<ApiConfig, true>) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;
    if (origin && !this.config.get('AUTH_ALLOWED_ORIGINS', { infer: true }).includes(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
    if (['POST', 'PATCH', 'PUT'].includes(request.method) && !request.is('application/json')) {
      throw new BadRequestException('Content-Type must be application/json');
    }
    return true;
  }
}
