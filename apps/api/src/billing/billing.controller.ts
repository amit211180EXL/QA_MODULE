import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@qa/shared';
import { buildResponse } from '../common/helpers/response.helper';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';

class CreateCheckoutSessionDto {
  plan!: 'BASIC' | 'PRO' | 'ENTERPRISE';
  successUrl!: string;
  cancelUrl!: string;
}

class ChangePlanDto {
  plan!: 'BASIC' | 'PRO' | 'ENTERPRISE';
  prorationBehavior?: 'create_prorations' | 'always_invoice' | 'none';
}

class CreatePortalSessionDto {
  returnUrl!: string;
}

@ApiTags('Billing')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Get subscription details and invoices' })
  async getSubscription(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.billingService.getSubscription(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Get current period usage vs plan limits' })
  async getUsage(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.billingService.getUsage(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('stripe/checkout')
  @ApiOperation({ summary: 'Create Stripe checkout session for plan subscription' })
  async createCheckoutSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCheckoutSessionDto,
    @Req() req: Request,
  ) {
    const result = await this.billingService.createCheckoutSession(
      user.tenantId,
      dto.plan,
      dto.successUrl,
      dto.cancelUrl,
    );
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('stripe/change-plan')
  @ApiOperation({ summary: 'Change Stripe subscription plan with selectable proration behavior' })
  async changePlan(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePlanDto,
    @Req() req: Request,
  ) {
    const result = await this.billingService.changePlan(
      user.tenantId,
      dto.plan,
      dto.prorationBehavior,
    );
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('stripe/cancel')
  @ApiOperation({ summary: 'Cancel Stripe subscription at period end' })
  async cancelSubscription(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.billingService.cancelSubscription(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('stripe/resume')
  @ApiOperation({ summary: 'Resume a Stripe subscription scheduled for cancellation' })
  async resumeSubscription(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const result = await this.billingService.resumeSubscription(user.tenantId);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Post('stripe/portal-session')
  @ApiOperation({ summary: 'Create Stripe customer portal session for payment recovery and billing updates' })
  async createPortalSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePortalSessionDto,
    @Req() req: Request,
  ) {
    const result = await this.billingService.createPortalSession(user.tenantId, dto.returnUrl);
    return buildResponse(result, (req as unknown as Record<string, string>)['requestId']);
  }

  @Public()
  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Stripe webhook events (subscription + invoice lifecycle)' })
  async stripeWebhook(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      return { received: false, reason: 'Missing raw request body' };
    }
    return this.billingService.handleStripeWebhook(signature, rawBody);
  }
}
