import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request } from 'express';
import { ConversationsService } from './conversations.service';
import { ListConversationsDto } from './dto/conversations.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '@qa/shared';
import { buildResponse } from '../common/helpers/response.helper';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List conversations with pagination' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListConversationsDto,
    @Req() req: Request,
  ) {
    const result = await this.conversationsService.listConversations(user.tenantId, query);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single conversation with its evaluation' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Req() req: Request) {
    const result = await this.conversationsService.getConversation(user.tenantId, id);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiConsumes('application/json')
  @ApiOperation({ summary: 'Bulk upload conversations (max 500 per request)' })
  async upload(
    @CurrentUser() user: JwtPayload,
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
    @Req() req: Request,
  ) {
    const result = await this.conversationsService.uploadConversations(user.tenantId, body);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('backfill-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Backfill evaluations for PENDING conversations that were uploaded before a form was published',
  })
  async backfillPending(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.conversationsService.backfillPendingEvaluations(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('remap-corrupted-qa-pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Remap QA_PENDING evaluations that point to corrupted forms to the latest valid published form per channel',
  })
  async remapCorruptedQaPending(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.conversationsService.remapCorruptedQaPendingEvaluations(
      user.tenantId,
    );
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }
}
