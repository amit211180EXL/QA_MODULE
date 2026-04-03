-- CreateEnum
CREATE TYPE "SmtpEncryption" AS ENUM ('NONE', 'TLS', 'SSL');

-- CreateTable
CREATE TABLE "tenant_email_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "encryption" "SmtpEncryption" NOT NULL DEFAULT 'TLS',
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpPassEnc" TEXT NOT NULL DEFAULT '',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT '',
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "forgotPasswordEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_email_settings_tenantId_key" ON "tenant_email_settings"("tenantId");

-- AddForeignKey
ALTER TABLE "tenant_email_settings" ADD CONSTRAINT "tenant_email_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
