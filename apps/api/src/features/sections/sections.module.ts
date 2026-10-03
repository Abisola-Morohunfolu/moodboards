import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { SectionsController } from './sections.controller';
import { SectionsRepository } from './sections.repository';
import { SectionsService } from './sections.service';

@Module({
  imports: [AccessModule, EventsModule],
  controllers: [SectionsController],
  providers: [SectionsRepository, SectionsService],
  exports: [SectionsRepository],
})
export class SectionsModule {}
