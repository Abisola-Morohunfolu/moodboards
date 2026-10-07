import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { ClientsRepository } from './clients.repository';
import { ClientsService } from './clients.service';
import {
  ClientsController,
  ContactsController,
  WorkspaceClientsController,
} from './clients.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
@Module({
  imports: [AccessModule, EventsModule, ApprovalsModule],
  providers: [ClientsRepository, ClientsService],
  controllers: [ClientsController, ContactsController, WorkspaceClientsController],
})
export class ClientsModule {}
