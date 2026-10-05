import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { ParticipantsRepository } from './participants.repository';
import { ParticipantsService } from './participants.service';
import { ParticipantsController } from './participants.controller';
@Module({
  imports: [AccessModule, EventsModule],
  providers: [ParticipantsRepository, ParticipantsService],
  controllers: [ParticipantsController],
})
export class ParticipantsModule {}
