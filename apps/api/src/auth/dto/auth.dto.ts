import { IsEmail, IsString, MinLength, Matches, IsEnum, IsOptional } from 'class-validator';
import { PlanType } from '@qa/shared';

export class SignupDto {
  @IsString()
  @MinLength(2)
  tenantName!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'tenantSlug must be lowercase letters, numbers, or hyphens' })
  @MinLength(3)
  tenantSlug!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  adminName!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsEnum(PlanType)
  plan!: PlanType;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

export class AcceptInviteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
