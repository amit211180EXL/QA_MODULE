import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { InviteUserDto, UpdateUserDto } from './dto/users.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';
import { buildResponse } from '../common/helpers/response.helper';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List all users in tenant' })
  async list(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.usersService.listUsers(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('invite')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Invite a new user' })
  async invite(@CurrentUser() user: JwtPayload, @Body() dto: InviteUserDto, @Req() req: Request) {
    const result = await this.usersService.inviteUser(user.tenantId, dto, user);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user by ID' })
  async getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Req() req: Request) {
    const result = await this.usersService.getUser(user.tenantId, id);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user name / role / status' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    const result = await this.usersService.updateUser(user.tenantId, id, dto);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate user (soft delete)' })
  async deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.usersService.deactivateUser(user.tenantId, id);
  }
}
