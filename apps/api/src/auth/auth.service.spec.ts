// Unit tests for AuthService
// jest.mock() is used for @qa/* packages so the mock factories replace the
// entire module before any imports are evaluated.

// ─── Module-level mock state (captured by factory closures below) ─────────────

// `mockDb` is assigned fresh in each beforeEach BEFORE any service instantiation.
// jest.mock hoisting means the mock registration runs first, but the factory
// closure captures `mockDb` by reference — the inner `() => mockDb` callback is
// only executed when getMasterClient() is CALLED (inside `new AuthService()`),
// at which point mockDb is already assigned.
let mockDb: {
  user: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  refreshToken: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  tenant: { findUnique: jest.Mock; create: jest.Mock };
  usageMetric: { upsert: jest.Mock };
};

jest.mock('@qa/prisma-master', () => ({
  getMasterClient: jest.fn(() => mockDb),
}));

// Inline env values so the factory has no external variable dependencies.
jest.mock('@qa/config', () => ({
  getEnv: jest.fn().mockReturnValue({
    JWT_SECRET: 'test-access-secret-at-least-32-chars-long!!',
    REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    JWT_EXPIRES_IN: '15m',
    REFRESH_EXPIRES_IN: '30d',
    REDIS_ENABLED: 'false', // prevents BullMQ Queue from being created
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  }),
}));

// bcrypt is a native addon — its exports are non-configurable/non-writable,
// so jest.spyOn fails. jest.mock replaces the module wholesale.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$hashed$'),
  compare: jest.fn().mockResolvedValue(true),
}));

// ─────────────────────────────────────────────────────────────────────────────

import { UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserRole } from '@qa/shared';

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme Corp',
  plan: 'PRO',
  status: 'ACTIVE',
};

const USER_ACTIVE = {
  id: 'user-1',
  email: 'admin@acme.com',
  name: 'Admin',
  passwordHash: '$2b$12$hashed',
  role: 'ADMIN',
  status: 'ACTIVE',
  tenantId: 'tenant-1',
  lastLoginAt: null,
  tenant: TENANT,
};

function makeStoredToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rt-1',
    userId: 'user-1',
    tokenHash: 'stored-hash',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let svc: AuthService;
  let mockJwt: { sign: jest.Mock; verify: jest.Mock };
  let mockRedis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(() => {
    // Fresh db mock for every test
    mockDb = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(USER_ACTIVE),
      },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'rt-new' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      usageMetric: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    // bcrypt is fully mocked — reset return values per test
    mockBcrypt.hash.mockResolvedValue('$2b$hashed$' as never);
    mockBcrypt.compare.mockResolvedValue(true as never);

    mockJwt = {
      sign: jest
        .fn()
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token'),
      verify: jest.fn(),
    };

    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    svc = new AuthService(mockJwt as any, mockRedis as any, { send: jest.fn().mockResolvedValue(undefined) } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns accessToken + refreshToken + user on success', async () => {
      mockDb.user.findFirst.mockResolvedValue(USER_ACTIVE);

      const result = await svc.login({ email: USER_ACTIVE.email, password: 'Pass1234!' });

      expect(result).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: USER_ACTIVE.id, email: USER_ACTIVE.email, role: USER_ACTIVE.role },
      });
    });

    it('updates lastLoginAt on successful login', async () => {
      mockDb.user.findFirst.mockResolvedValue(USER_ACTIVE);

      await svc.login({ email: USER_ACTIVE.email, password: 'Pass1234!' });

      expect(mockDb.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ACTIVE.id },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });

    it('throws UnauthorizedException (INVALID_CREDENTIALS) when user is not found', async () => {
      mockDb.user.findFirst.mockResolvedValue(null);

      await expect(svc.login({ email: 'nobody@x.com', password: 'pw' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      mockDb.user.findFirst.mockResolvedValue(USER_ACTIVE);
      mockBcrypt.compare.mockResolvedValue(false as never);

      await expect(svc.login({ email: USER_ACTIVE.email, password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException (ACCOUNT_SUSPENDED) when user is INACTIVE', async () => {
      mockDb.user.findFirst.mockResolvedValue({ ...USER_ACTIVE, status: 'INACTIVE' });

      await expect(
        svc.login({ email: USER_ACTIVE.email, password: 'Pass1234!' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when tenant status is SUSPENDED', async () => {
      mockDb.user.findFirst.mockResolvedValue({
        ...USER_ACTIVE,
        tenant: { ...TENANT, status: 'SUSPENDED' },
      });

      await expect(
        svc.login({ email: USER_ACTIVE.email, password: 'Pass1234!' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when tenant status is CANCELLED', async () => {
      mockDb.user.findFirst.mockResolvedValue({
        ...USER_ACTIVE,
        tenant: { ...TENANT, status: 'CANCELLED' },
      });

      await expect(
        svc.login({ email: USER_ACTIVE.email, password: 'Pass1234!' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('signs access token with type=access and correct payload fields', async () => {
      mockDb.user.findFirst.mockResolvedValue(USER_ACTIVE);

      await svc.login({ email: USER_ACTIVE.email, password: 'Pass1234!' });

      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: USER_ACTIVE.id,
          tenantId: USER_ACTIVE.tenantId,
          role: USER_ACTIVE.role,
          type: 'access',
        }),
        expect.any(Object),
      );
    });
  });

  // ─── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    const refreshPayload = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      type: 'refresh',
    };

    beforeEach(() => {
      // Reset the sign queue so refresh tests see 'new-*' values first
      mockJwt.sign.mockReset();
      mockJwt.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
    });

    it('returns a new token pair when refresh token is valid', async () => {
      mockJwt.verify.mockReturnValue(refreshPayload);
      mockDb.refreshToken.findUnique.mockResolvedValue(makeStoredToken());

      const result = await svc.refresh('valid-refresh-token');

      expect(result).toMatchObject({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('revokes the old token before issuing the new pair', async () => {
      mockJwt.verify.mockReturnValue(refreshPayload);
      mockDb.refreshToken.findUnique.mockResolvedValue(makeStoredToken());

      await svc.refresh('valid-refresh-token');

      expect(mockDb.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws UnauthorizedException (TOKEN_EXPIRED) when JWT verification fails', async () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('jwt expired'); });

      await expect(svc.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException (TOKEN_REVOKED) when stored token has been revoked', async () => {
      mockJwt.verify.mockReturnValue(refreshPayload);
      mockDb.refreshToken.findUnique.mockResolvedValue(
        makeStoredToken({ revokedAt: new Date() }),
      );

      await expect(svc.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when stored token is not found', async () => {
      mockJwt.verify.mockReturnValue(refreshPayload);
      mockDb.refreshToken.findUnique.mockResolvedValue(null);

      await expect(svc.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when stored token has expired in DB', async () => {
      mockJwt.verify.mockReturnValue(refreshPayload);
      mockDb.refreshToken.findUnique.mockResolvedValue(
        makeStoredToken({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(svc.refresh('db-expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects access tokens used as refresh tokens (wrong type)', async () => {
      mockJwt.verify.mockReturnValue({ ...refreshPayload, type: 'access' });

      await expect(svc.refresh('access-as-refresh')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('revokes the matching un-revoked refresh token', async () => {
      await svc.logout('some-refresh-token');

      expect(mockDb.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ revokedAt: null }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('does not throw when the token is already purged or not found', async () => {
      mockDb.refreshToken.updateMany.mockRejectedValueOnce(new Error('not found'));
      await expect(svc.logout('ghost-token')).resolves.not.toThrow();
    });
  });

  // ─── acceptInvite ──────────────────────────────────────────────────────────

  describe('acceptInvite', () => {
    const invitePayload = {
      sub: 'user-invited',
      tenantId: 'tenant-1',
      role: UserRole.QA,
      type: 'invite',
    };

    const INVITED_USER = { ...USER_ACTIVE, id: 'user-invited', role: 'QA', status: 'INVITED' };

    beforeEach(() => {
      // Reset so acceptInvite tests see 'invite-*' values first
      mockJwt.sign.mockReset();
      mockJwt.sign
        .mockReturnValueOnce('invite-access-token')
        .mockReturnValueOnce('invite-refresh-token');
    });

    it('activates user, hashes password, returns tokens', async () => {
      mockJwt.verify.mockReturnValue(invitePayload);
      mockDb.user.findUnique.mockResolvedValue(INVITED_USER);
      mockDb.user.update.mockResolvedValue({ ...INVITED_USER, status: 'ACTIVE' });

      const result = await svc.acceptInvite({ token: 'invite-jwt', password: 'NewPass1!' });

      expect(result.accessToken).toBe('invite-access-token');
      expect(mockDb.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: INVITED_USER.id },
          data: expect.objectContaining({ status: 'ACTIVE', passwordHash: '$2b$hashed$' }),
        }),
      );
    });

    it('throws BadRequestException (INVITE_ALREADY_USED) when user is already ACTIVE', async () => {
      mockJwt.verify.mockReturnValue(invitePayload);
      mockDb.user.findUnique.mockResolvedValue({ ...INVITED_USER, status: 'ACTIVE' });

      await expect(
        svc.acceptInvite({ token: 'invite-jwt', password: 'Pass1!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException (INVITE_ALREADY_USED) when user is not found', async () => {
      mockJwt.verify.mockReturnValue(invitePayload);
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(
        svc.acceptInvite({ token: 'invite-jwt', password: 'Pass1!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException (INVALID_INVITE_TOKEN) on bad JWT signature', async () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('invalid signature'); });

      await expect(
        svc.acceptInvite({ token: 'bad-token', password: 'Pw1!' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when token type is not "invite"', async () => {
      mockJwt.verify.mockReturnValue({ ...invitePayload, type: 'access' });

      await expect(
        svc.acceptInvite({ token: 'access-jwt-as-invite', password: 'Pw1!' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
