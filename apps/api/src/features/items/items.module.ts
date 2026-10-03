import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { SectionsModule } from '../sections/sections.module';
import { BoardItemsController, ItemsController } from './items.controller';
import { ItemsRepository } from './items.repository';
import { ItemsService } from './items.service';

@Module({
  imports: [AccessModule, EventsModule, SectionsModule],
  controllers: [BoardItemsController, ItemsController],
  providers: [ItemsRepository, ItemsService],
})
export class ItemsModule {}
