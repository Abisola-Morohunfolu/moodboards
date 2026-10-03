import { Module } from '@nestjs/common';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';

@Module({
  providers: [AccessRepository, AccessService],
  exports: [AccessService, AccessRepository],
})
export class AccessModule {}
