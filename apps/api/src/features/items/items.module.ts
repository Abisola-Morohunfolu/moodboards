import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AccessModule } from '../access/access.module';
import { EventsModule } from '../../platform/events/events.module';
import { SectionsModule } from '../sections/sections.module';
import { BoardItemsController, ItemsController } from './items.controller';
import { ItemsRepository } from './items.repository';
import { ItemPreviewsRepository } from './item-previews.repository';
import { ItemsService } from './items.service';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [AssetsModule, AccessModule, EventsModule, SectionsModule, ApprovalsModule],
  controllers: [BoardItemsController, ItemsController],
  providers: [ItemsRepository, ItemPreviewsRepository, ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
