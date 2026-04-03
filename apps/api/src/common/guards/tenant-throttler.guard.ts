import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const tenantId = req?.user?.tenantId;
    if (typeof tenantId === 'string' && tenantId.length > 0) {
      return `tenant:${tenantId}`;
    }

    const apiKey = req?.headers?.['x-api-key'];
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      const keyHash = createHash('sha256').update(apiKey).digest('hex');
      return `apikey:${keyHash}`;
    }

    const ip = req?.ip || req?.socket?.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }
}