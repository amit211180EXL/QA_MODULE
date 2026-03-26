import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  scoringStrategy!: Record<string, unknown>;

  @ApiProperty({ description: 'Sections array' })
  sections!: unknown[];

  @ApiProperty({ description: 'Questions array' })
  questions!: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
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
  scoringStrategy?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  sections?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  questions?: unknown[];
}

export enum FormStatusAction {
  PUBLISH = 'publish',
  DEPRECATE = 'deprecate',
  ARCHIVE = 'archive',
}

export class FormStatusActionDto {
  @ApiProperty({ enum: FormStatusAction })
  @IsEnum(FormStatusAction)
  action!: FormStatusAction;
}
