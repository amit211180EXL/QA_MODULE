import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { getMasterClient } from '@qa/prisma-master';
import { getEnv } from '@qa/config';
import { JwtPayload, UserRole, NotifySendJobPayload, QUEUE_NAMES } from '@qa/shared';
import { Queue } from 'bullmq';
import { InviteUserDto, UpdateUserDto } from './dto/users.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';

@Injectable()
export class UsersService {
  private readonly db = getMasterClient();
  private readonly notifyQueue: Queue | null = null;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const env = getEnv();
    if (env.REDIS_ENABLED !== 'false') {
      this.notifyQueue = new Queue(QUEUE_NAMES.NOTIFY_SEND, {
        connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD },
      });
    }
  }

  async listUsers(tenantId: string) {
    return this.db.user.findMany({
      where: { tenantId },
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
    });
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

  async inviteUser(tenantId: string, dto: InviteUserDto, invitedBy: JwtPayload) {
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

    const user = await this.db.user.create({
      data: {
        tenantId,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        passwordHash: await bcrypt.hash(this.generateTempPassword(), 12),
        status: 'INVITED',
      },
    });

    // Issue invite JWT (72h expiry)
    const invitePayload: JwtPayload = {
      sub: user.id,
      tenantId,
      role: user.role as UserRole,
      type: 'invite',
    };
    const env = getEnv();
    const inviteToken = this.jwtService.sign(invitePayload, {
      secret: env.JWT_SECRET,
      expiresIn: '72h',
    });

    // Enqueue notification
    const notifyPayload: NotifySendJobPayload = {
      tenantId,
      type: 'user_invited',
      recipientIds: [user.id],
      data: {
        inviteToken,
        invitedByName: invitedBy.sub,
        acceptUrl: `${env.API_URL}/accept-invite`,
      },
    };
    if (this.notifyQueue) {
      try {
        await this.notifyQueue.add('notify', notifyPayload, { attempts: 3 });
      } catch (e) {
        console.warn('[Users] notify queue error:', (e as Error).message);
      }
    }

    if (env.NODE_ENV === 'development') {
      console.log(`[DEV] Invite token for ${dto.email}: ${inviteToken}`);
    }

    return { user: { id: user.id, email: user.email, role: user.role, status: user.status } };
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

  private generateTempPassword(): string {
    return `Temp${Math.random().toString(36).slice(2, 12)}!`;
  }
}
