import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateBoardRequest,
  UpdateBoardRequest,
  createBoardRequestSchema,
  updateBoardRequestSchema,
} from '@moodboard/contracts';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { BoardsService } from './boards.service';

@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new SchemaPipe(createBoardRequestSchema)) input: CreateBoardRequest,
  ) {
    return this.boards.create(user.userId, input);
  }
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.boards.list(user.userId);
  }
  @Get(':id')
  get(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.boards.get(user.userId, id);
  }
  @Patch(':id')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateBoardRequestSchema)) input: UpdateBoardRequest,
  ) {
    return this.boards.update(user.userId, id, input);
  }
}

@Controller('workspaces/:id/boards')
export class WorkspaceBoardsController {
  constructor(private readonly boards: BoardsService) {}
  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.boards.list(user.userId, id);
  }
}
