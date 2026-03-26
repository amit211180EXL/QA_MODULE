import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import { PLAN_FEATURES, JwtPayload, PlanType } from '@qa/shared';
import type { MasterPrismaClient } from '@qa/prisma-master';

@Injectable()
export class FeatureGateGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject('MASTER_DB') private master: MasterPrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Feature() decorator — gate does not apply
    if (!feature) return true;

    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();

    const tenant = await this.master.tenant.findUnique({
      where: { id: user.tenantId },
      select: { plan: true },
    });

    const plan = (tenant?.plan ?? PlanType.BASIC) as PlanType;
    const allowed = PLAN_FEATURES[plan] ?? [];

    if (!allowed.includes(feature)) {
      throw new ForbiddenException({
        code: 'PLAN_FEATURE_NOT_AVAILABLE',
        message: `Feature "${feature}" is not available on the ${plan} plan.`,
      });
    }

    return true;
  }
}
