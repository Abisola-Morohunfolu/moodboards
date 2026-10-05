import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { withTransaction } from '@moodboard/database';
import { assetUrlQuerySchema, emptyRequestSchema } from '@moodboard/contracts';
import type { Request, Response } from 'express';
import { ApiConfig } from '../../config';
import { ContactOnly, CurrentContact, Public } from '../auth/auth.decorators';
import { CONTACT_COOKIE, SESSION_SECONDS, clearCookie, writeCookie } from '../auth/cookies';
import { RateLimitService } from '../auth/rate-limit.service';
import { SchemaPipe } from '../auth/validation.pipe';
import { ContactPrincipal } from '../access/contact-access';
import { ContactSessionRepository } from '../access/contact-session.repository';
import { BoardsService } from '../boards/boards.service';
import { ItemsService } from '../items/items.service';
import { AssetsService } from '../assets/assets.service';
import { ShareRepository } from './share.repository';

@Controller('share')
export class ShareController {
  constructor(
    private readonly source: DataSource,
    private readonly shares: ShareRepository,
    private readonly limits: RateLimitService,
    private readonly config: ConfigService<ApiConfig, true>,
  ) {}
  @Public()
  @Get(':token')
  async open(
    @Param('token') token: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Referrer-Policy', 'no-referrer');
    await this.limits.enforce('contact-link', request.ip ?? 'unknown', 30, response);
    const result = await withTransaction(this.source, (manager) =>
      this.shares.exchange(manager, token),
    );
    writeCookie(
      response,
      CONTACT_COOKIE,
      result.token,
      this.config.get('NODE_ENV', { infer: true }) === 'production',
      SESSION_SECONDS,
    );
    return result.response;
  }
}
@ContactOnly()
@Controller('client')
export class ClientViewController {
  constructor(
    private readonly boards: BoardsService,
    private readonly items: ItemsService,
    private readonly assets: AssetsService,
    private readonly sessions: ContactSessionRepository,
    private readonly config: ConfigService<ApiConfig, true>,
  ) {}
  @Get('board')
  board(@CurrentContact() contact: ContactPrincipal) {
    return this.boards.get(contact, contact.boardId);
  }
  @Get('board/items')
  list(@CurrentContact() contact: ContactPrincipal) {
    return this.items.list(contact, contact.boardId);
  }
  @Get('assets/:id/url')
  url(
    @CurrentContact() contact: ContactPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(assetUrlQuerySchema)) query: { variant: 'original' | 'thumbnail' },
  ) {
    return this.assets.url(contact, id, query.variant);
  }
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentContact() contact: ContactPrincipal,
    @Body(new SchemaPipe(emptyRequestSchema)) _input: Record<string, never>,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.revoke(contact.sessionHash);
    clearCookie(
      response,
      CONTACT_COOKIE,
      this.config.get('NODE_ENV', { infer: true }) === 'production',
    );
  }
}
