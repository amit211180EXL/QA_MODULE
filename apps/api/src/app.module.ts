import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { TenantModule } from './tenant/tenant.module';
import { LlmConfigModule } from './llm-config/llm-config.module';
import { TenantSettingsModule } from './tenant-settings/tenant-settings.module';
import { ConversationsModule } from './conversations/conversations.module';
import { FormsModule } from './forms/forms.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { FeatureGateGuard } from './common/guards/feature-gate.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ConfigModule,
    DatabaseModule,
    RedisModule,
    TenantModule,
    AuthModule,
    UsersModule,
    LlmConfigModule,
    TenantSettingsModule,
    ConversationsModule,
    FormsModule,
    EvaluationsModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    // Global throttle guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global JWT guard (routes opt out with @Public())
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global roles guard
    { provide: APP_GUARD, useClass: RolesGuard },
    // Global feature-gate guard (checks @Feature() against tenant plan)
    { provide: APP_GUARD, useClass: FeatureGateGuard },
  ],
})
export class AppModule {}
