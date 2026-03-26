import { Controller, Post, Get, Body, Req, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  SignupDto,
  LoginDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  AcceptInviteDto,
} from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '@qa/shared';
import { buildResponse } from '../common/helpers/response.helper';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Register new tenant and admin user' })
  async signup(@Body() dto: SignupDto, @Req() req: Request) {
    const result = await this.authService.signup(dto);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Login — returns access + refresh tokens' })
  async login(
    @Body() dto: LoginDto,
    @Headers('x-tenant-slug') tenantSlug: string | undefined,
    @Req() req: Request,
  ) {
    const result = await this.authService.login(dto, tenantSlug);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const result = await this.authService.refresh(dto.refreshToken);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke current refresh token' })
  async logout(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    await this.authService.logout(dto.refreshToken);
    return buildResponse(
      { success: true },
      (req as unknown as Record<string, string>)['requestId'],
    );
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Send password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.authService.forgotPassword(dto.email);
    // Always return success to avoid email enumeration
    return buildResponse(
      { message: 'If that email exists, a reset link has been sent' },
      (req as unknown as Record<string, string>)['requestId'],
    );
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume reset token and set new password' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.authService.resetPassword(dto);
    return buildResponse(
      { success: true },
      (req as unknown as Record<string, string>)['requestId'],
    );
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept invite, set password, activate account' })
  async acceptInvite(@Body() dto: AcceptInviteDto, @Req() req: Request) {
    const result = await this.authService.acceptInvite(dto);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.authService.getMe(user.sub);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }
}
