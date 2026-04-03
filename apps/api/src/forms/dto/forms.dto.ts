import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListFormsDto {
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

  @ApiPropertyOptional({ description: 'Search by form key, name, or description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED'] })
  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateFormDefinitionDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  formKey!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Array of channel strings e.g. ["CHAT","EMAIL"]' })
  @IsArray()
  channels!: string[];

  @ApiProperty({ description: 'Scoring strategy config object' })
  @IsObject()
  scoringStrategy!: Record<string, unknown>;

  @ApiProperty({ description: 'Sections array' })
  @IsArray()
  sections!: unknown[];

  @ApiProperty({ description: 'Questions array' })
  @IsArray()
  questions!: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFormDefinitionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  channels?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  scoringStrategy?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  sections?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  questions?: unknown[];
}

export enum FormStatusAction {
  PUBLISH = 'publish',
  UNPUBLISH = 'unpublish',
  DEPRECATE = 'deprecate',
  ARCHIVE = 'archive',
}

export class FormStatusActionDto {
  @ApiProperty({ enum: FormStatusAction })
  @IsEnum(FormStatusAction)
  action!: FormStatusAction;
}
