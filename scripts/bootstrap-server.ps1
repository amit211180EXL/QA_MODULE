$ErrorActionPreference = 'Stop'

# One-click server DB bootstrap + Prisma migration/seed for QA Platform.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-server.ps1
#   $env:POSTGRES_USER='postgres'; powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-server.ps1
#   $env:BOOTSTRAP_SQL='.\\db-server-bootstrap.sql'; powershell -ExecutionPolicy Bypass -File .\\scripts\\bootstrap-server.ps1

$rootDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $rootDir

$postgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'postgres' }
$postgresDb = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'postgres' }
$postgresHost = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { 'localhost' }
$postgresPort = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
$bootstrapSql = if ($env:BOOTSTRAP_SQL) { $env:BOOTSTRAP_SQL } else { Join-Path $rootDir 'db-server-bootstrap.sql' }

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql is not installed or not in PATH.'
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'pnpm is not installed or not in PATH.'
}

if (-not (Test-Path -LiteralPath $bootstrapSql)) {
  throw "Bootstrap SQL file not found at: $bootstrapSql"
}

$bootstrapSqlText = Get-Content -LiteralPath $bootstrapSql -Raw
if ($bootstrapSqlText -match 'CHANGE_ME_MASTER_PASSWORD|CHANGE_ME_TENANT_SUPERUSER_PASSWORD') {
  throw 'db-server-bootstrap.sql still contains placeholder passwords. Update both CHANGE_ME values first.'
}

$envFile = Join-Path $rootDir '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw ".env not found in repo root ($envFile). Create it first (for example: copy .env.example .env)."
}

Write-Host '[1/5] Running PostgreSQL bootstrap SQL...'
& psql -h $postgresHost -p $postgresPort -U $postgresUser -d $postgresDb -f $bootstrapSql

Write-Host '[2/5] Installing dependencies...'
& pnpm install

Write-Host '[3/5] Generating Prisma clients...'
& pnpm db:generate

Write-Host '[4/5] Applying Prisma migrations...'
& pnpm db:migrate:deploy:all

Write-Host '[5/5] Seeding database...'
& pnpm db:seed

Write-Host 'Done. Server database bootstrap and app DB setup completed successfully.'
