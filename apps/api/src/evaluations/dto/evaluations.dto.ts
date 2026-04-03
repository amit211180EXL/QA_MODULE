import {
  IsOptional,
  IsString,
  IsInt,
  IsObject,
  IsArray,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum EvalQueueType {
  QA = 'qa',
  VERIFIER = 'verifier',
}

export class ListEvaluationsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workflowState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string;

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

export class QaSubmitDto {
  @ApiProperty({
    description: 'Map of questionKey → { value, overrideReason }',
    example: { q1: { value: 4, overrideReason: 'Agent followed script' } },
  })
  @IsObject()
  adjustedAnswers!: Record<string, { value: unknown; overrideReason?: string }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feedback?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  flags?: string[];
}

export class VerifierModifyDto {
  @ApiProperty({
    description: 'Map of questionKey → { value, overrideReason }',
  })
  @IsObject()
  modifiedAnswers!: Record<string, { value: unknown; overrideReason: string }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  feedback?: string;
}

export class VerifierRejectDto {
  @ApiProperty({ description: 'Reason for rejection back to QA' })
  @IsString()
  @MinLength(5)
  reason!: string;
}

export class PreviewScoreDto {
  @ApiProperty()
  @IsString()
  formId!: string;

  @ApiProperty({ description: 'Map of questionKey → answer value' })
  @IsObject()
  answers!: Record<string, unknown>;
}

// ─── Assignment DTOs ──────────────────────────────────────────────────────────

export class ManualAssignDto {
  @ApiProperty({ description: 'Evaluation ID to assign' })
  @IsString()
  evaluationId!: string;

  @ApiProperty({ description: 'Target user ID to assign to' })
  @IsString()
  userId!: string;
}

export class BulkRoundRobinDto {
  @ApiProperty({ description: 'Queue type: QA_QUEUE or VERIFIER_QUEUE' })
  @IsString()
  queueType!: string;

  @ApiPropertyOptional({ description: 'Max items to distribute (default: all unassigned)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class ReassignDto {
  @ApiProperty({ description: 'Evaluation ID to reassign' })
  @IsString()
  evaluationId!: string;

  @ApiProperty({ description: 'New user ID to reassign to' })
  @IsString()
  newUserId!: string;

  @ApiPropertyOptional({ description: 'Reason for reassignment' })
  @IsOptional()
  @IsString()
  reason?: string;
}
