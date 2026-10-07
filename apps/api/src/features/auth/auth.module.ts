import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AccountController, AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { GoogleAttemptsRepository } from './google-attempts.repository';
import { GoogleService } from './google.service';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import { RequestProtectionGuard } from './request-protection.guard';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionRepository } from './session.repository';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [WorkspacesModule, AccessModule],
  controllers: [AuthController, AccountController],
  providers: [
    AuthRepository,
    AuthService,
    GoogleService,
    GoogleAttemptsRepository,
    PasswordService,
    RateLimitService,
    RedisRateLimitStore,
    SessionRepository,
    { provide: APP_GUARD, useClass: RequestProtectionGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
  exports: [SessionRepository, RateLimitService],
})
export class AuthModule {}
