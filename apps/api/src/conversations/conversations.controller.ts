import { Controller, Get, Post, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { ListConversationsDto } from './dto/conversations.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '@qa/shared';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List conversations with pagination' })
  async list(@CurrentUser() user: JwtPayload, @Query() query: ListConversationsDto) {
    return this.conversationsService.listConversations(user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single conversation with its evaluation' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversationsService.getConversation(user.tenantId, id);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
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
  ) {
    return this.conversationsService.uploadConversations(user.tenantId, body);
  }
}
