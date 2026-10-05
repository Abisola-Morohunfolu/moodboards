import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessModule } from '../access/access.module';
import { BoardsModule } from '../boards/boards.module';
import { ItemsModule } from '../items/items.module';
import { AssetsModule } from '../assets/assets.module';
import { ShareController, ClientViewController } from './client-view.controller';
import { ShareRepository } from './share.repository';
@Module({
  imports: [AuthModule, AccessModule, BoardsModule, ItemsModule, AssetsModule],
  controllers: [ShareController, ClientViewController],
  providers: [ShareRepository],
})
export class ClientViewModule {}
