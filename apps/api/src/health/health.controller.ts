import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly metricsService: MetricsService,
  ) {}

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

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  async metrics() {
    return this.metricsService.getMetricsText();
  }
}
