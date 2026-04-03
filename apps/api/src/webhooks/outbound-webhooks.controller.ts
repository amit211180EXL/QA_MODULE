import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { OutboundWebhooksService, WebhookEvent } from './outbound-webhooks.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';

class CreateOutboundWebhookDto {
  @IsUrl({ require_tld: false })
  @IsString()
  url!: string;

  @IsArray()
  @IsString({ each: true })
  events!: WebhookEvent[];
}

class UpdateStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}

class ListDeliveriesQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  webhookId?: string;

  @IsOptional()
  @IsIn(['PENDING', 'DELIVERED', 'FAILED'])
  status?: 'PENDING' | 'DELIVERED' | 'FAILED';
}

@ApiTags('Outbound Webhooks')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('outbound-webhooks')
export class OutboundWebhooksController {
  constructor(private readonly service: OutboundWebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new outbound webhook endpoint' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOutboundWebhookDto) {
    return this.service.create(user.tenantId, dto.url, dto.events);
  }

  @Get()
  @ApiOperation({ summary: 'List all outbound webhook subscriptions for tenant' })
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user.tenantId);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'List outbound webhook delivery attempts' })
  async listDeliveries(@CurrentUser() user: JwtPayload, @Query() query: ListDeliveriesQueryDto) {
    return this.service.listDeliveries(
      user.tenantId,
      Number(query.page ?? 1),
      Number(query.limit ?? 50),
      query.webhookId,
      query.status,
    );
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable or disable an outbound webhook' })
  async updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.service.updateStatus(user.tenantId, id, dto.status);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the signing secret for an outbound webhook' })
  async rotateSecret(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.rotateSecret(user.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an outbound webhook subscription' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.service.remove(user.tenantId, id);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed outbound webhook delivery' })
  async retryDelivery(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.retryDelivery(user.tenantId, id);
  }
}
