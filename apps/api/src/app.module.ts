import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { BillingModule } from './billing/billing.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NotifyModule } from './notify/notify.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { FeatureGateGuard } from './common/guards/feature-gate.guard';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
import { StaleQueueEscalationService } from './workers/stale-queue-escalation.service';

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
    BillingModule,
    WebhooksModule,
    NotifyModule,
    HealthModule,
  ],
  providers: [
    // Global JWT guard (routes opt out with @Public())
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global throttle guard (tenant-keyed when authenticated)
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
    // Global roles guard
    { provide: APP_GUARD, useClass: RolesGuard },
    // Global feature-gate guard (checks @Feature() against tenant plan)
    { provide: APP_GUARD, useClass: FeatureGateGuard },
    // Stale queue escalation background job
    StaleQueueEscalationService,
    // HTTP metrics interceptor
    MetricsInterceptor,
  ],
})
export class AppModule {}
