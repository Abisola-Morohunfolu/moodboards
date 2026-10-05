import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssetsService } from './assets.service';
import { AssetsController, BoardAssetsController } from './assets.controller';
@Module({
  imports: [AccessModule],
  providers: [AssetsService],
  controllers: [AssetsController, BoardAssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
