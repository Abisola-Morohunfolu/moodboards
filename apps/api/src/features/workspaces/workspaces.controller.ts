import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateWorkspaceRequest, createWorkspaceRequestSchema } from '@moodboard/contracts';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { WorkspacesRepository } from './workspaces.repository';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesRepository) {}
  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.workspaces.list(user.userId);
  }
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new SchemaPipe(createWorkspaceRequestSchema)) input: CreateWorkspaceRequest,
  ) {
    return this.workspaces.create(user.userId, input.name);
  }
}
