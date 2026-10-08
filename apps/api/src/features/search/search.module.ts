import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { workspaceSearchQuerySchema, WorkspaceSearchQuery } from '@moodboard/contracts';
import { AccessModule } from '../access/access.module';
import { ItemsRepository } from '../items/items.repository';
import { AuthPrincipal, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { SearchService } from './search.service';

@Controller('workspaces/:id/search')
class SearchController {
  constructor(private readonly search: SearchService) {}
  @Get()
  get(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new SchemaPipe(workspaceSearchQuerySchema)) query: WorkspaceSearchQuery,
  ) {
    return this.search.find(user.userId, id, query);
  }
}

@Module({
  imports: [AccessModule],
  controllers: [SearchController],
  providers: [SearchService, ItemsRepository],
})
export class SearchModule {}
