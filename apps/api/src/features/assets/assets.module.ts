import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AssetsRepository } from './assets.repository';
import { AssetsService } from './assets.service';
import { AssetsController, BoardAssetsController } from './assets.controller';
@Module({
  imports: [AccessModule],
  providers: [AssetsService, AssetsRepository],
  controllers: [AssetsController, BoardAssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
