import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { LiveResponse } from '@moodboard/contracts';
import { Public } from '../auth/auth.decorators';
import { HealthService } from './health.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  live(): LiveResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const result = await this.health.ready();
    if (result.status === 'down') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
