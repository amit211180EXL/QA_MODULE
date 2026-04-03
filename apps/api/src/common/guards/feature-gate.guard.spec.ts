// Unit tests for FeatureGateGuard
// Tests the plan-based feature gating logic without a live database or HTTP server.

jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(),
}));

jest.mock('@qa/config', () => ({
  getEnv: jest.fn().mockReturnValue({
    REDIS_ENABLED: 'false',
  }),
}));

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGateGuard } from './feature-gate.guard';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import { PlanType, UserRole } from '@qa/shared';
import type { ExecutionContext } from '@nestjs/common';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildContext(user: { sub: string; tenantId: string; role: UserRole }): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FeatureGateGuard', () => {
  let reflector: Reflector;
  let masterDb: { tenant: { findUnique: jest.Mock } };
  let guard: FeatureGateGuard;

  const user = { sub: 'u-1', tenantId: 'tenant-1', role: UserRole.ADMIN };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
    masterDb = { tenant: { findUnique: jest.fn() } };
    guard = new FeatureGateGuard(reflector, masterDb as any);
  });

  // ─── No decorator — always allow ──────────────────────────────────────────

  it('allows any request when no @Feature() decorator is present', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    const result = await guard.canActivate(buildContext(user));

    expect(result).toBe(true);
    // Should NOT hit the database when there's no feature to check
    expect(masterDb.tenant.findUnique).not.toHaveBeenCalled();
  });

  // ─── BASIC plan ───────────────────────────────────────────────────────────

  it('allows BASIC plan to access a BASIC feature (evaluations)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('evaluations');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.BASIC });

    const result = await guard.canActivate(buildContext(user));

    expect(result).toBe(true);
  });

  it('denies BASIC plan access to a PRO-only feature (blind_review)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('blind_review');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.BASIC });

    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(ForbiddenException);
  });

  it('denies BASIC plan access to an ENTERPRISE-only feature (byo_llm)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('byo_llm');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.BASIC });

    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(ForbiddenException);
  });

  it('includes PLAN_FEATURE_NOT_AVAILABLE error code in the exception', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('blind_review');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.BASIC });

    try {
      await guard.canActivate(buildContext(user));
    } catch (e: any) {
      expect(e.response?.code).toBe('PLAN_FEATURE_NOT_AVAILABLE');
    }
  });

  // ─── PRO plan ─────────────────────────────────────────────────────────────

  it('allows PRO plan to access PRO feature (blind_review)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('blind_review');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.PRO });

    const result = await guard.canActivate(buildContext(user));

    expect(result).toBe(true);
  });

  it('denies PRO plan access to ENTERPRISE-only feature (sso)', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('sso');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.PRO });

    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(ForbiddenException);
  });

  // ─── ENTERPRISE plan ──────────────────────────────────────────────────────

  it('allows ENTERPRISE plan to access any feature', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('sso');
    masterDb.tenant.findUnique.mockResolvedValue({ plan: PlanType.ENTERPRISE });

    const result = await guard.canActivate(buildContext(user));

    expect(result).toBe(true);
  });

  // ─── Tenant not found ─────────────────────────────────────────────────────

  it('defaults to BASIC plan when tenant record is not found', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue('blind_review');
    masterDb.tenant.findUnique.mockResolvedValue(null);

    // blind_review is PRO-only; null tenant → BASIC → denied
    await expect(guard.canActivate(buildContext(user))).rejects.toThrow(ForbiddenException);
  });

  // ─── Reflector uses correct metadata key ─────────────────────────────────

  it('looks up feature metadata using the FEATURE_KEY token', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const ctx = buildContext(user);

    await guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      FEATURE_KEY,
      expect.arrayContaining([ctx.getHandler(), ctx.getClass()]),
    );
  });
});
