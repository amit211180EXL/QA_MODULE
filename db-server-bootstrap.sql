-- QA Platform: Server bootstrap SQL
-- Purpose: Prepare a fresh PostgreSQL server so this codebase can be moved/deployed easily.
-- Run as a PostgreSQL superuser (for example: postgres) on the target server.
--
-- Example:
--   psql -U postgres -d postgres -f db-server-bootstrap.sql
--
-- Notes:
-- 1) Edit passwords below before running in production.
-- 2) This script is idempotent for roles/databases.

DO $$
DECLARE
  v_master_user text := 'qa_master';
  v_master_pass text := 'CHANGE_ME_MASTER_PASSWORD';
  v_master_db   text := 'qa_master';

  v_tenant_super_user text := 'qa_superuser';
  v_tenant_super_pass text := 'CHANGE_ME_TENANT_SUPERUSER_PASSWORD';
BEGIN
  IF v_master_pass LIKE 'CHANGE_ME%' OR v_tenant_super_pass LIKE 'CHANGE_ME%' THEN
    RAISE EXCEPTION 'Update placeholder passwords in db-server-bootstrap.sql before running this script.';
  END IF;

  -- Master app role (owns master DB)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_master_user) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', v_master_user, v_master_pass);
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', v_master_user, v_master_pass);
  END IF;

  -- Master DB (stores tenants/users/billing/config)
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = v_master_db) THEN
    EXECUTE format('CREATE DATABASE %I OWNER %I', v_master_db, v_master_user);
  ELSE
    EXECUTE format('ALTER DATABASE %I OWNER TO %I', v_master_db, v_master_user);
  END IF;

  -- Tenant provisioning superuser (used by app to create tenant DBs)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_tenant_super_user) THEN
    EXECUTE format(
      'CREATE ROLE %I LOGIN PASSWORD %L CREATEDB CREATEROLE',
      v_tenant_super_user,
      v_tenant_super_pass
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE %I WITH LOGIN PASSWORD %L CREATEDB CREATEROLE',
      v_tenant_super_user,
      v_tenant_super_pass
    );
  END IF;
END
$$;

-- Ensure connection privileges are present
GRANT ALL PRIVILEGES ON DATABASE qa_master TO qa_master;

-- Optional: verify setup quickly
-- SELECT rolname, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname IN ('qa_master', 'qa_superuser');
-- SELECT datname FROM pg_database WHERE datname = 'qa_master';
