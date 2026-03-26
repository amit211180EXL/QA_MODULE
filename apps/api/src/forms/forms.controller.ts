import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FormsService } from './forms.service';
import { CreateFormDefinitionDto, UpdateFormDefinitionDto, FormStatusActionDto } from './dto/forms.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';

@ApiTags('Forms')
@ApiBearerAuth()
@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get()
  @ApiOperation({ summary: 'List all non-archived form definitions' })
  async list(@CurrentUser() user: JwtPayload) {
    return this.formsService.listForms(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single form definition' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.formsService.getForm(user.tenantId, id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new form definition (Admin only)' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFormDefinitionDto) {
    return this.formsService.createForm(user.tenantId, dto, user.sub);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a DRAFT form definition (Admin only)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFormDefinitionDto,
  ) {
    return this.formsService.updateForm(user.tenantId, id, dto);
  }

  @Post(':id/status')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish / deprecate / archive a form (Admin only)' })
  async changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: FormStatusActionDto,
  ) {
    return this.formsService.changeStatus(user.tenantId, id, dto.action);
  }
}
