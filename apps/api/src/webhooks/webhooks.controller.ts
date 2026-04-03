import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * External conversation ingestion endpoint.
   * Authenticated with X-Api-Key (tenant API key) instead of JWT.
   * Used by CRMs, chat platforms, and other integrations.
   */
  @Post('ingest')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'Ingest conversations from external system via API key' })
  @ApiHeader({ name: 'X-Api-Key', description: 'Tenant API key', required: true })
  async ingest(
    @Headers('x-api-key') apiKey: string,
    @Body()
    body: {
      channel: string;
      conversations: Array<{
        externalId?: string;
        agentId?: string;
        agentName?: string;
        customerRef?: string;
        content: unknown;
        metadata?: unknown;
        receivedAt?: string;
      }>;
    },
  ) {
    if (!apiKey) {
      throw new UnauthorizedException({ code: 'MISSING_API_KEY', message: 'X-Api-Key required' });
    }

    if (!body.channel) {
      throw new BadRequestException({ code: 'MISSING_CHANNEL', message: 'channel is required' });
    }

    if (!Array.isArray(body.conversations) || body.conversations.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_PAYLOAD', message: 'conversations array is required and must not be empty' });
    }

    if (body.conversations.length > 500) {
      throw new BadRequestException({ code: 'BATCH_TOO_LARGE', message: 'Maximum 500 conversations per request' });
    }

    const tenantId = await this.webhooksService.resolveTenantByApiKey(apiKey);

    return this.webhooksService.ingestConversations(tenantId, body);
  }
}
