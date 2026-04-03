import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum ConvStatusFilter {
  PENDING = 'PENDING',
  EVALUATING = 'EVALUATING',
  QA_REVIEW = 'QA_REVIEW',
  VERIFIER_REVIEW = 'VERIFIER_REVIEW',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export class ListConversationsDto {
  @ApiPropertyOptional({ enum: ConvStatusFilter })
  @IsOptional()
  @IsEnum(ConvStatusFilter)
  status?: ConvStatusFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ description: 'Search by external ID, channel, agent name, or customer reference' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
