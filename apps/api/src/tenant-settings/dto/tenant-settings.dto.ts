import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEscalationRulesDto {
  @ApiPropertyOptional({ default: 15, description: 'QA deviation % that triggers escalation' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  qaDeviationThreshold?: number;

  @ApiPropertyOptional({
    default: 10,
    description: 'Verifier deviation % that triggers escalation',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  verifierDeviationThreshold?: number;

  @ApiPropertyOptional({ default: 24, description: 'Hours before queue item is considered stale' })
  @IsOptional()
  @IsInt()
  @Min(1)
  staleQueueHours?: number;
}

export class UpdateBlindReviewDto {
  @ApiPropertyOptional({ default: false, description: 'Hide agent name from QA reviewer' })
  @IsOptional()
  @IsBoolean()
  hideAgentFromQA?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Hide QA scores from verifier' })
  @IsOptional()
  @IsBoolean()
  hideQAFromVerifier?: boolean;
}

const SMTP_ENCRYPTION = ['NONE', 'TLS', 'SSL'] as const;

export class UpdateTenantEmailSettingsDto {
  @ApiPropertyOptional({ example: 'smtp.sendgrid.net' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpHost?: string;

  @ApiPropertyOptional({ example: 587 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @ApiPropertyOptional({ enum: SMTP_ENCRYPTION })
  @IsOptional()
  @IsIn(SMTP_ENCRYPTION)
  encryption?: (typeof SMTP_ENCRYPTION)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smtpUsername?: string;

  /** Omit to leave unchanged; empty string clears stored password. */
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  smtpPassword?: string;

  @ApiPropertyOptional({ example: 'support@acme.com' })
  @ValidateIf((o: UpdateTenantEmailSettingsDto) => !!o.smtpHost?.trim())
  @IsEmail()
  fromEmail?: string;

  @ApiPropertyOptional({ example: 'Acme QA' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  forgotPasswordEnabled?: boolean;
}

export class SendTestEmailDto {
  @ApiPropertyOptional({ example: 'you@company.com' })
  @IsEmail()
  to!: string;
}
