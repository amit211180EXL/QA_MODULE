import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
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
