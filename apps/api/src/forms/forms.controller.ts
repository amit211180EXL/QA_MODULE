import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { FormsService } from './forms.service';
import {
  CreateFormDefinitionDto,
  UpdateFormDefinitionDto,
  FormStatusActionDto,
  ListFormsDto,
} from './dto/forms.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';
import { buildResponse } from '../common/helpers/response.helper';

@ApiTags('Forms')
@ApiBearerAuth()
@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get()
  @ApiOperation({ summary: 'List all non-archived form definitions' })
  async list(@CurrentUser() user: JwtPayload, @Query() query: ListFormsDto, @Req() req: Request) {
    const result = await this.formsService.listForms(user.tenantId, query);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single form definition' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Req() req: Request) {
    const result = await this.formsService.getForm(user.tenantId, id);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new form definition (Admin only)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFormDefinitionDto,
    @Req() req: Request,
  ) {
    const result = await this.formsService.createForm(user.tenantId, dto, user.sub);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a DRAFT form definition (Admin only)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFormDefinitionDto,
    @Req() req: Request,
  ) {
    const result = await this.formsService.updateForm(user.tenantId, id, dto);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post(':id/status')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish / deprecate / archive a form (Admin only)' })
  async changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: FormStatusActionDto,
    @Req() req: Request,
  ) {
    const result = await this.formsService.changeStatus(user.tenantId, id, dto.action);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }
}
