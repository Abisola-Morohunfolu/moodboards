import { Module } from '@nestjs/common';
import { AccessRepository } from './access.repository';
import { AccessService } from './access.service';
import { ContactLinks } from './contact-links';
import { ContactSessionRepository } from './contact-session.repository';

@Module({
  providers: [AccessRepository, AccessService, ContactLinks, ContactSessionRepository],
  exports: [AccessService, AccessRepository, ContactLinks, ContactSessionRepository],
})
export class AccessModule {}
