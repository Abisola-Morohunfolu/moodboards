import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  createClientRequestSchema,
  clientListQuerySchema,
  createContactRequestSchema,
  CreateClientRequest,
  CreateContactRequest,
} from '@moodboard/contracts';
import { CurrentUser, AuthPrincipal } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { ClientsService } from './clients.service';

@Controller('workspaces/:id/clients')
export class WorkspaceClientsController {
  constructor(private readonly clients: ClientsService) {}
  @Get()
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(clientListQuerySchema)) query: { includeArchived: boolean },
  ) {
    return this.clients.list(user.userId, id, query.includeArchived);
  }
  @Post()
  create(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(createClientRequestSchema)) input: CreateClientRequest,
  ) {
    return this.clients.create(user.userId, id, input.name);
  }
}
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}
  @Delete(':id')
  @HttpCode(204)
  archive(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.clients.archive(user.userId, id);
  }
  @Get(':id/contacts')
  contacts(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.clients.contacts(user.userId, id);
  }
  @Post(':id/contacts')
  createContact(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(createContactRequestSchema)) input: CreateContactRequest,
  ) {
    return this.clients.createContact(user.userId, id, input);
  }
}
@Controller('contacts')
export class ContactsController {
  constructor(private readonly clients: ClientsService) {}
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.clients.removeContact(user.userId, id);
  }
}
