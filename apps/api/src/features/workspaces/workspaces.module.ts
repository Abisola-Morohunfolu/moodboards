import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesRepository } from './workspaces.repository';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesRepository],
  exports: [WorkspacesRepository],
})
export class WorkspacesModule {}
