import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateItemRequest,
  MoveNoteRequest,
  UpdateNoteRequest,
  createItemRequestSchema,
  moveNoteRequestSchema,
  updateNoteRequestSchema,
  pageQuerySchema,
  PageQuery,
  restoreItemRequestSchema,
  RestoreItemRequest,
} from '@moodboard/contracts';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { ItemsService } from './items.service';

@Controller('boards/:id/items')
export class BoardItemsController {
  constructor(private readonly items: ItemsService) {}
  @Get('trash')
  trash(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return this.items.trash(user.userId, id, query);
  }
  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.items.list(user.userId, id);
  }
  @Post()
  async create(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(createItemRequestSchema)) input: CreateItemRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.items.create(user.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.item;
  }
}

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}
  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(restoreItemRequestSchema)) input: RestoreItemRequest,
  ) {
    return this.items.restore(user.userId, id, input);
  }
  @Patch(':id/position')
  move(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(moveNoteRequestSchema)) input: MoveNoteRequest,
  ) {
    return this.items.move(user.userId, id, input);
  }
  @Patch(':id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateNoteRequestSchema)) input: UpdateNoteRequest,
  ) {
    return this.items.update(user.userId, id, input);
  }
  @Delete(':id')
  @HttpCode(204)
  delete(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.items.delete(user.userId, id);
  }
}
