import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateSectionRequest,
  UpdateSectionRequest,
  createSectionRequestSchema,
  updateSectionRequestSchema,
} from '@moodboard/contracts';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { SectionsService } from './sections.service';

@Controller('boards/:id/sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(createSectionRequestSchema)) input: CreateSectionRequest,
  ) {
    return this.sections.create(user.userId, id, input);
  }
  @Patch(':sid')
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sid', new ParseUUIDPipe()) sid: string,
    @Body(new SchemaPipe(updateSectionRequestSchema)) input: UpdateSectionRequest,
  ) {
    return this.sections.update(user.userId, id, sid, input);
  }
  @Delete(':sid')
  @HttpCode(204)
  delete(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sid', new ParseUUIDPipe()) sid: string,
  ) {
    return this.sections.delete(user.userId, id, sid);
  }
}
