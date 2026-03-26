import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum LlmProviderDto {
  OPENAI = 'OPENAI',
  AZURE_OPENAI = 'AZURE_OPENAI',
  CUSTOM = 'CUSTOM',
}

export class UpsertLlmConfigDto {
  @ApiProperty({ enum: LlmProviderDto })
  @IsEnum(LlmProviderDto)
  provider!: LlmProviderDto;

  @ApiProperty({ example: 'gpt-4o' })
  @IsString()
  @MinLength(1)
  model!: string;

  @ApiProperty({ description: 'Plaintext API key — stored encrypted', example: 'sk-...' })
  @IsString()
  @MinLength(8)
  apiKey!: string;

  @ApiPropertyOptional({ description: 'Required for AZURE_OPENAI and CUSTOM providers' })
  @IsOptional()
  @IsUrl()
  endpoint?: string;

  @ApiPropertyOptional({ default: 0.2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ default: 2048 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTokens?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
