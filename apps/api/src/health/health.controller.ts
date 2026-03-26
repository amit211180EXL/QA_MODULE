import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  liveness() {
    return this.healthService.checkLiveness();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check — DB + Redis' })
  readiness() {
    return this.healthService.checkReadiness();
  }
}
