-- Add outbound webhook delivery status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboundWebhookDeliveryStatus') THEN
    CREATE TYPE "OutboundWebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');
  END IF;
END $$;

-- Create outbound webhook deliveries table
CREATE TABLE IF NOT EXISTS "outbound_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboundWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "httpStatus" INTEGER,
  "errorMessage" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outbound_webhook_deliveries_tenantId_createdAt_idx" ON "outbound_webhook_deliveries"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "outbound_webhook_deliveries_webhookId_createdAt_idx" ON "outbound_webhook_deliveries"("webhookId", "createdAt");
CREATE INDEX IF NOT EXISTS "outbound_webhook_deliveries_status_createdAt_idx" ON "outbound_webhook_deliveries"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'outbound_webhook_deliveries_webhookId_fkey'
      AND table_name = 'outbound_webhook_deliveries'
  ) THEN
    ALTER TABLE "outbound_webhook_deliveries"
      ADD CONSTRAINT "outbound_webhook_deliveries_webhookId_fkey"
      FOREIGN KEY ("webhookId") REFERENCES "outbound_webhooks"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'outbound_webhook_deliveries_tenantId_fkey'
      AND table_name = 'outbound_webhook_deliveries'
  ) THEN
    ALTER TABLE "outbound_webhook_deliveries"
      ADD CONSTRAINT "outbound_webhook_deliveries_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
