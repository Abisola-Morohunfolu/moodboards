import { Controller, Get, Post, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { PresignRequest, presignRequestSchema, assetUrlQuerySchema } from '@moodboard/contracts';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { AssetsService } from './assets.service';
@Controller('boards/:id/assets')
export class BoardAssetsController {
  constructor(private readonly assets: AssetsService) {}
  @Post('presign')
  presign(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(presignRequestSchema)) input: PresignRequest,
  ) {
    return this.assets.presign(user.userId, id, input);
  }
}
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}
  @Get(':id/url')
  url(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(assetUrlQuerySchema)) query: { variant: 'original' | 'thumbnail' },
  ) {
    return this.assets.url(user.userId, id, query.variant);
  }
}
