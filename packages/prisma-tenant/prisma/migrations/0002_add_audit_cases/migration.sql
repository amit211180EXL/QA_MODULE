-- Add AuditCase status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditCaseStatus') THEN
    CREATE TYPE "AuditCaseStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
  END IF;
END $$;

-- Create audit_cases table
CREATE TABLE IF NOT EXISTS "audit_cases" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "status" "AuditCaseStatus" NOT NULL DEFAULT 'OPEN',
  "deviation" DOUBLE PRECISION NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "resolutionNote" TEXT,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "audit_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "audit_cases_evaluationId_key" ON "audit_cases"("evaluationId");
CREATE INDEX IF NOT EXISTS "audit_cases_status_createdAt_idx" ON "audit_cases"("status", "createdAt");

-- FK to evaluations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_cases_evaluationId_fkey'
      AND table_name = 'audit_cases'
  ) THEN
    ALTER TABLE "audit_cases"
      ADD CONSTRAINT "audit_cases_evaluationId_fkey"
      FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
