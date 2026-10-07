import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { DecisionRequest, decisionRequestSchema } from '@moodboard/contracts';
import type { Response } from 'express';
import { AuthPrincipal, ContactOnly, CurrentContact, CurrentUser } from '../auth/auth.decorators';
import { SchemaPipe } from '../auth/validation.pipe';
import { ContactPrincipal } from '../access/contact-access';
import { ApprovalsService } from './approvals.service';

@Controller('boards/:id/approvals')
export class PlannerApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal, @Param('id', new ParseUUIDPipe()) boardId: string) {
    return this.approvals.plannerList(user.userId, boardId);
  }
}

@ContactOnly()
@Controller('client/board/approvals')
export class ClientApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@CurrentContact() contact: ContactPrincipal) {
    return this.approvals.clientList(contact);
  }

  @Post('decisions')
  async decide(
    @CurrentContact() contact: ContactPrincipal,
    @Body(new SchemaPipe(decisionRequestSchema)) input: DecisionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.approvals.decide(contact, input);
    response.status(result.created ? 201 : 200);
    return result.body;
  }
}
