-- Add Stripe webhook event status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StripeWebhookEventStatus') THEN
    CREATE TYPE "StripeWebhookEventStatus" AS ENUM ('PROCESSING', 'PROCESSED', 'FAILED');
  END IF;
END $$;

-- Create stripe webhook events table for idempotency + retry diagnostics
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "StripeWebhookEventStatus" NOT NULL DEFAULT 'PROCESSING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_stripeEventId_key"
  ON "stripe_webhook_events"("stripeEventId");

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_eventType_createdAt_idx"
  ON "stripe_webhook_events"("eventType", "createdAt");

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_status_createdAt_idx"
  ON "stripe_webhook_events"("status", "createdAt");
