import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { getMasterClient } from '@qa/prisma-master';
import { encrypt, decrypt, maskSecret } from '../common/utils/encryption.util';
import { UpsertLlmConfigDto } from './dto/llm-config.dto';

@Injectable()
export class LlmConfigService {
  private readonly db = getMasterClient();

  async getConfig(tenantId: string) {
    const config = await this.db.llmConfig.findUnique({ where: { tenantId } });
    if (!config) return null;

    return {
      id: config.id,
      enabled: config.enabled,
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maskedKey: maskSecret(decrypt(config.apiKeyEnc)),
      updatedAt: config.updatedAt,
    };
  }

  async upsertConfig(tenantId: string, dto: UpsertLlmConfigDto) {
    const apiKeyEnc = encrypt(dto.apiKey);

    const data = {
      tenantId,
      enabled: dto.enabled ?? true,
      provider: dto.provider as never,
      model: dto.model,
      endpoint: dto.endpoint ?? null,
      apiKeyEnc,
      temperature: dto.temperature ?? 0.2,
      maxTokens: dto.maxTokens ?? 2048,
    };

    const config = await this.db.llmConfig.upsert({
      where: { tenantId },
      create: data,
      update: {
        enabled: data.enabled,
        provider: data.provider,
        model: data.model,
        endpoint: data.endpoint,
        apiKeyEnc: data.apiKeyEnc,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
      },
    });

    return {
      id: config.id,
      enabled: config.enabled,
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maskedKey: maskSecret(dto.apiKey),
      updatedAt: config.updatedAt,
    };
  }

  async testConnection(tenantId: string): Promise<{ ok: boolean; latencyMs: number }> {
    const config = await this.db.llmConfig.findUnique({ where: { tenantId } });
    if (!config) {
      throw new NotFoundException({
        code: 'LLM_CONFIG_NOT_FOUND',
        message: 'LLM configuration not found',
      });
    }
    if (!config.enabled) {
      throw new BadRequestException({
        code: 'LLM_DISABLED',
        message: 'LLM is disabled for this tenant',
      });
    }

    const apiKey = decrypt(config.apiKeyEnc);
    const start = Date.now();

    try {
      const url =
        config.provider === 'OPENAI'
          ? 'https://api.openai.com/v1/models'
          : config.endpoint
            ? `${config.endpoint}/openai/models?api-version=2024-02-01`
            : null;

      if (!url) {
        throw new BadRequestException({
          code: 'MISSING_ENDPOINT',
          message: 'Endpoint required for this provider',
        });
      }

      const headers: Record<string, string> =
        config.provider === 'AZURE_OPENAI'
          ? { 'api-key': apiKey }
          : { Authorization: `Bearer ${apiKey}` };

      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        throw new BadRequestException({
          code: 'LLM_AUTH_FAILED',
          message: `LLM provider returned ${res.status}`,
        });
      }

      return { ok: true, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      throw new InternalServerErrorException({
        code: 'LLM_UNREACHABLE',
        message: err instanceof Error ? err.message : 'Unable to reach LLM provider',
      });
    }
  }
}
