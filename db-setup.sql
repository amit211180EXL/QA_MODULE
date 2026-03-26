-- Run this in pgAdmin > Query Tool (connected as superuser postgres)
-- ─── Step 1: Create master DB user and database ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qa_master') THEN
    CREATE ROLE qa_master LOGIN PASSWORD 'masterpass';
  END IF;
END$$;

CREATE DATABASE qa_master OWNER qa_master;

GRANT ALL PRIVILEGES ON DATABASE qa_master TO qa_master;

-- ─── Step 2: Create tenant superuser (for provisioning tenant DBs) ───────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'qa_superuser') THEN
    CREATE ROLE qa_superuser LOGIN PASSWORD 'superpass' CREATEDB CREATEROLE;
  END IF;
END$$;
