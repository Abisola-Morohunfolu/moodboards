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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AssignContactRequest,
  UpdateContactParticipantRequest,
  assignContactRequestSchema,
  updateContactParticipantRequestSchema,
  emptyRequestSchema,
} from '@moodboard/contracts';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { ParticipantsService } from './participants.service';

@Controller('boards/:id/participants')
export class ParticipantsController {
  constructor(private readonly participants: ParticipantsService) {}
  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.participants.list(user.userId, id);
  }
  @Post()
  async assign(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(assignContactRequestSchema)) input: AssignContactRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.participants.assign(user.userId, id, input);
    response.status(result.created ? 201 : 200);
    return result.participant;
  }
  @Patch(':pid')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pid', new ParseUUIDPipe()) pid: string,
    @Body(new SchemaPipe(updateContactParticipantRequestSchema))
    input: UpdateContactParticipantRequest,
  ) {
    return this.participants.change(user.userId, id, pid, 'update', input);
  }
  @Delete(':pid')
  @HttpCode(204)
  revoke(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pid', new ParseUUIDPipe()) pid: string,
  ) {
    return this.participants.change(user.userId, id, pid, 'revoke');
  }
  @Get(':pid/link')
  link(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pid', new ParseUUIDPipe()) pid: string,
  ) {
    return this.participants.change(user.userId, id, pid, 'link');
  }
  @Post(':pid/new-link')
  @HttpCode(200)
  rotate(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pid', new ParseUUIDPipe()) pid: string,
    @Body(new SchemaPipe(emptyRequestSchema)) _input: Record<string, never>,
  ) {
    return this.participants.change(user.userId, id, pid, 'rotate');
  }
}
