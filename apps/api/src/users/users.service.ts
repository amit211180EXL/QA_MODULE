import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getMasterClient } from '@qa/prisma-master';
import { JwtPayload, UserRole, PLAN_LIMITS, PlanType } from '@qa/shared';
import { JwtService } from '@nestjs/jwt';
import { getEnv } from '@qa/config';
import { CreateUserDto, InviteUserDto, ListUsersDto, UpdateUserDto } from './dto/users.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class UsersService {
  private readonly db = getMasterClient();

  constructor(private readonly jwtService: JwtService) {}

  async listUsers(tenantId: string, query: ListUsersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;

    if (query.search?.trim()) {
      const s = query.search.trim();
      where.OR = [
        { email: { contains: s, mode: 'insensitive' } },
        { name: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.user.count({ where }),
    ]);

    return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getUser(tenantId: string, userId: string) {
    const user = await this.db.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return user;
  }

  async createUser(tenantId: string, dto: CreateUserDto) {
    // Check duplicate
    const existing = await this.db.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'USER_ALREADY_EXISTS',
        message: 'User with this email already exists',
      });
    }

    // Plan limit check
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true },
    });
    const limits = PLAN_LIMITS[tenant.plan as PlanType];
    if (limits && limits.users !== 999_999) {
      const currentCount = await this.db.user.count({
        where: { tenantId, status: { not: 'INACTIVE' } },
      });
      if (currentCount >= limits.users) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `User limit of ${limits.users} reached on ${tenant.plan} plan. Upgrade to create more users.`,
        });
      }
    }

    // Use provided password or generate a strong one
    const plainPassword = dto.password ?? this.generatePassword();
    const passwordHash = await bcrypt.hash(plainPassword, 12);

    const user = await this.db.user.create({
      data: { tenantId, email: dto.email, name: dto.name, role: dto.role, passwordHash, status: 'ACTIVE' },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });

    // Return plain password once so admin can share credentials
    return { user, password: plainPassword };
  }

  async updateUser(tenantId: string, userId: string, dto: UpdateUserDto) {
    const user = await this.db.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    // Cannot demote last admin
    if (dto.role && dto.role !== UserRole.ADMIN && user.role === 'ADMIN') {
      const adminCount = await this.db.user.count({
        where: { tenantId, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException({
          code: 'CANNOT_DEMOTE_LAST_ADMIN',
          message: 'Cannot change role of the only active admin',
        });
      }
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.role && { role: dto.role }),
        ...(dto.status && { status: dto.status }),
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    });
    return { user: updated };
  }

  async deactivateUser(tenantId: string, userId: string) {
    const user = await this.db.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    if (user.role === 'ADMIN') {
      const adminCount = await this.db.user.count({
        where: { tenantId, role: 'ADMIN', status: 'ACTIVE' },
      });
      if (adminCount <= 1) {
        throw new ForbiddenException({
          code: 'CANNOT_DEACTIVATE_LAST_ADMIN',
          message: 'Cannot deactivate the only active admin',
        });
      }
    }

    await this.db.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });

    // Revoke all tokens
    await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private generatePassword(): string {
    // 16 hex chars + suffix = readable strong password
    return `Qa${randomBytes(8).toString('hex')}!`;
  }

  async inviteUser(tenantId: string, dto: InviteUserDto) {
    const existing = await this.db.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'USER_ALREADY_EXISTS',
        message: 'User with this email already exists',
      });
    }

    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { plan: true },
    });
    const limits = PLAN_LIMITS[tenant.plan as PlanType];
    if (limits && limits.users !== 999_999) {
      const currentCount = await this.db.user.count({
        where: { tenantId, status: { not: 'INACTIVE' } },
      });
      if (currentCount >= limits.users) {
        throw new BadRequestException({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `User limit of ${limits.users} reached on ${tenant.plan} plan.`,
        });
      }
    }

    const user = await this.db.user.create({
      data: {
        tenantId,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        passwordHash: '',
        status: 'INVITED',
      },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    });

    const invitePayload: JwtPayload = {
      sub: user.id,
      tenantId,
      role: dto.role as UserRole,
      type: 'invite',
    };
    const env = getEnv();
    const inviteToken = this.jwtService.sign(invitePayload, {
      secret: env.JWT_SECRET,
      expiresIn: '7d',
    });

    return { user, inviteToken };
  }
}
