import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  LoginRequest,
  loginRequestSchema,
  SignupRequest,
  signupRequestSchema,
} from '@moodboard/contracts';
import { ApiConfig } from '../../config';
import { AuthPrincipal, CurrentUser, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import {
  clearCookie,
  FLOW_COOKIE,
  readCookie,
  SESSION_COOKIE,
  SESSION_SECONDS,
  writeCookie,
} from './cookies';
import { GoogleService } from './google.service';
import { RateLimitService } from './rate-limit.service';
import { SessionRepository } from './session.repository';
import { SchemaPipe } from './validation.pipe';

const callbackSchema = z.object({
  state: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionRepository,
    private readonly google: GoogleService,
    private readonly limits: RateLimitService,
    private readonly config: ConfigService<ApiConfig, true>,
  ) {}
  private get production(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
  @Public()
  @Post('signup')
  async signup(
    @Body(new SchemaPipe(signupRequestSchema)) input: SignupRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce('signup', request.ip ?? 'unknown', 5, response);
    const result = await this.auth.signup(input);
    writeCookie(response, SESSION_COOKIE, result.token, this.production, SESSION_SECONDS);
    return result.account;
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new SchemaPipe(loginRequestSchema)) input: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce('login', request.ip ?? 'unknown', 10, response, input.email);
    const result = await this.auth.login(input);
    writeCookie(response, SESSION_COOKIE, result.token, this.production, SESSION_SECONDS);
    return result.account;
  }
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(user.sessionHash);
    clearCookie(response, SESSION_COOKIE, this.production);
  }
  @Public()
  @Get('google')
  async googleStart(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.limits.enforce('google-start', request.ip ?? 'unknown', 20, response);
    const { state, url } = await this.google.start();
    writeCookie(response, FLOW_COOKIE, state, this.production, 600);
    response.redirect(url);
  }
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query() query: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.limits.enforce('google-callback', request.ip ?? 'unknown', 20, response);
    const parsed = callbackSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Invalid Google callback');
    }
    const cookie = readCookie(request, FLOW_COOKIE);
    clearCookie(response, FLOW_COOKIE, this.production);
    const attempt = await this.google.consume(parsed.data.state, cookie);
    if (parsed.data.error) {
      throw new UnauthorizedException('Google sign-in cancelled');
    }
    if (!parsed.data.code) {
      throw new BadRequestException('Missing Google authorization code');
    }
    const identity = await this.google.exchange(parsed.data.code, attempt);
    const result = await this.auth.google(identity);
    writeCookie(response, SESSION_COOKIE, result.token, this.production, SESSION_SECONDS);
    return result.account;
  }
}
@Controller()
export class AccountController {
  constructor(private readonly auth: AuthService) {}
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.account(user.userId);
  }
}
