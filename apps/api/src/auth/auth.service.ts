import {
  Injectable,
  Inject,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { getMasterClient } from '@qa/prisma-master';
import { getEnv } from '@qa/config';
import { JwtPayload, UserRole, TenantProvisionJobPayload, QUEUE_NAMES, PlanType } from '@qa/shared';
import { Queue } from 'bullmq';
import { SignupDto, LoginDto, ResetPasswordDto, AcceptInviteDto } from './dto/auth.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';

const BCRYPT_ROUNDS = 12;
const PASSWORD_RESET_TTL_S = 15 * 60; // 15 minutes

@Injectable()
export class AuthService {
  private readonly db = getMasterClient();
  private readonly provisionQueue: Queue;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const env = getEnv();
    this.provisionQueue = new Queue(QUEUE_NAMES.TENANT_PROVISION, {
      connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD },
    });
  }

  // ─── Signup ──────────────────────────────────────────────────────────────────

  async signup(dto: SignupDto) {
    const existing = await this.db.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (existing) {
      throw new ConflictException({ code: 'TENANT_SLUG_TAKEN', message: 'Tenant slug is already taken' });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const tenant = await this.db.tenant.create({
      data: {
        slug: dto.tenantSlug,
        name: dto.tenantName,
        plan: dto.plan,
        status: 'PROVISIONING',
        users: {
          create: {
            email: dto.adminEmail,
            name: dto.adminName,
            passwordHash,
            role: 'ADMIN',
            status: 'INVITED',
          },
        },
        subscription: {
          create: {
            plan: dto.plan,
            status: 'TRIALING',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      include: { users: true },
    });

    const admin = tenant.users[0];

    // Enqueue provisioning job
    const payload: TenantProvisionJobPayload = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      adminUserId: admin.id,
      plan: tenant.plan as PlanType,
    };
    await this.provisionQueue.add('provision', payload, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10_000 },
      removeOnComplete: { count: 100 },
    });

    const { accessToken, refreshToken } = await this.issueTokens(admin.id, tenant.id, admin.role as UserRole);

    return {
      accessToken,
      refreshToken,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan },
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, tenantSlug?: string) {
    // Find user across tenants by email (unique per tenant, so we need slug context)
    // In practice, login form captures email; tenant resolved from subdomain/slug header
    const user = await this.db.user.findFirst({
      where: {
        email: dto.email,
        ...(tenantSlug ? { tenant: { slug: tenantSlug } } : {}),
      },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    if (user.status === 'INACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account is deactivated' });
    }

    if (user.tenant.status === 'SUSPENDED' || user.tenant.status === 'CANCELLED') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Tenant account is suspended' });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { accessToken, refreshToken } = await this.issueTokens(user.id, user.tenantId, user.role as UserRole);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  // ─── Refresh ──────────────────────────────────────────────────────────────────

  async refresh(rawRefreshToken: string) {
    let payload: JwtPayload;
    const env = getEnv();

    try {
      payload = this.jwtService.verify<JwtPayload>(rawRefreshToken, {
        secret: env.REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Refresh token is expired or invalid' });
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException({ code: 'TOKEN_EXPIRED', message: 'Invalid token type' });
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.db.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'TOKEN_REVOKED', message: 'Refresh token has been revoked' });
    }

    // Rotate: revoke old, issue new pair
    await this.db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(payload.sub, payload.tenantId, payload.role);
  }

  // ─── Logout ───────────────────────────────────────────────────────────────────

  async logout(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.db.refreshToken
      .updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => null); // Swallow — token may not exist (already expired/purged)
  }

  // ─── Forgot Password ──────────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.db.user.findFirst({ where: { email } });
    if (!user) return; // Don't reveal whether email exists

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const ttl = PASSWORD_RESET_TTL_S;
    await this.redis.set(`pwd_reset:${tokenHash}`, user.id, 'EX', ttl);

    // TODO: enqueue notify:send[password_reset] with reset link
    // For now log in dev only
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] Password reset token for ${email}: ${token}`);
    }
  }

  // ─── Reset Password ───────────────────────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);
    const userId = await this.redis.get(`pwd_reset:${tokenHash}`);
    if (!userId) {
      throw new BadRequestException({ code: 'INVALID_RESET_TOKEN', message: 'Reset token is invalid or expired' });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.db.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.redis.del(`pwd_reset:${tokenHash}`);
    // Revoke all existing refresh tokens for this user
    await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Accept Invite ────────────────────────────────────────────────────────────

  async acceptInvite(dto: AcceptInviteDto) {
    const env = getEnv();
    let payload: JwtPayload;

    try {
      payload = this.jwtService.verify<JwtPayload>(dto.token, { secret: env.JWT_SECRET });
    } catch {
      throw new BadRequestException({ code: 'INVALID_INVITE_TOKEN', message: 'Invite token is invalid or expired' });
    }

    if (payload.type !== 'invite') {
      throw new BadRequestException({ code: 'INVALID_INVITE_TOKEN', message: 'Invalid token type' });
    }

    const user = await this.db.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'INVITED') {
      throw new BadRequestException({ code: 'INVITE_ALREADY_USED', message: 'Invite has already been used' });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const updated = await this.db.user.update({
      where: { id: user.id },
      data: { passwordHash, status: 'ACTIVE' },
    });

    const { accessToken, refreshToken } = await this.issueTokens(updated.id, updated.tenantId, updated.role as UserRole);
    return {
      accessToken,
      refreshToken,
      user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role },
    };
  }

  // ─── Me ───────────────────────────────────────────────────────────────────────

  async getMe(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, status: true, tenantId: true, lastLoginAt: true },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return user;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async issueTokens(userId: string, tenantId: string, role: UserRole) {
    const env = getEnv();

    const accessPayload: JwtPayload = { sub: userId, tenantId, role, type: 'access' };
    const refreshPayload: JwtPayload = { sub: userId, tenantId, role, type: 'refresh' };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: env.JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN,
    });

    const rawRefresh = this.jwtService.sign(refreshPayload, {
      secret: env.REFRESH_SECRET,
      expiresIn: env.REFRESH_EXPIRES_IN,
    });

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.db.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawRefresh),
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefresh };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
