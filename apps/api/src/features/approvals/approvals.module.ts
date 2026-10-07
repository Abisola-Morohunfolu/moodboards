import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { ClientApprovalsController, PlannerApprovalsController } from './approvals.controller';
import { ApprovalsRepository } from './approvals.repository';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [AccessModule, EventsModule],
  controllers: [PlannerApprovalsController, ClientApprovalsController],
  providers: [ApprovalsRepository, ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
