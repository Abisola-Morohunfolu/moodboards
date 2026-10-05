import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { SectionsModule } from '../sections/sections.module';
import { BoardsController, WorkspaceBoardsController } from './boards.controller';
import { BoardsRepository } from './boards.repository';
import { BoardsService } from './boards.service';

@Module({
  imports: [AccessModule, EventsModule, SectionsModule],
  controllers: [BoardsController, WorkspaceBoardsController],
  providers: [BoardsRepository, BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
