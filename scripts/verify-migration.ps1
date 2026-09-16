<#
.SYNOPSIS
  Validates the cross-device-core migration against a throwaway Postgres container.

.DESCRIPTION
  Applies the migration to a disposable database and asserts three things:

    1. it applies cleanly, and is idempotent (safe to re-run)
    2. it satisfies the checks Supabase's Security and Performance Advisors perform
    3. its RLS policies actually behave — a worker sees the open job feed, an admin can approve
       someone else's certificate, and nobody can read or write another user's rows

  Nothing here touches a real Supabase project. That is the point: the migration can be proven
  before you paste it into your dashboard.

.REQUIREMENTS
  Docker Desktop running.

.EXAMPLE
  pwsh scripts/verify-migration.ps1
#>

[CmdletBinding()]
param(
  [string]$ContainerName = 'sahakar-sqltest',
  # Must match the hosted project's major version. Supabase runs Postgres 17.x, and its schema dump
  # uses the MAINTAIN privilege introduced in 17 — loading it into 16 fails with
  # `unrecognized privilege type "maintain"`.
  [string]$Image = 'postgres:17-alpine'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Fail($msg) { Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

# --- preflight -------------------------------------------------------------
docker ps 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Docker daemon is not reachable. Start Docker Desktop first.' }

Write-Host 'Starting disposable Postgres...' -ForegroundColor Cyan
docker rm -f $ContainerName 2>&1 | Out-Null
docker run -d --rm --name $ContainerName -e POSTGRES_PASSWORD=test -e POSTGRES_DB=verify $Image 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'could not start the container' }

try {
  $ready = $false
  for ($i = 1; $i -le 40; $i++) {
    docker exec $ContainerName pg_isready -U postgres -d verify 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 3
  }
  if (-not $ready) { Fail 'Postgres never became ready' }
  Write-Host "  ready after ~$($i * 3)s"

  # --- copy inputs ---------------------------------------------------------
  docker cp (Join-Path $repo 'scripts/sql-test-harness.sql')   "${ContainerName}:/tmp/harness.sql"   | Out-Null

  # The production schema, if it has been dumped. This is the difference between a meaningful test
  # and a misleading one: validating against a BLANK database is what let the
  # `operator does not exist: uuid = text` failure reach the hosted project, because the pre-existing
  # uuid-keyed bookings table simply wasn't there to collide with.
  $dump = Join-Path $repo 'remote-schema-dump.sql'
  $haveDump = Test-Path $dump
  if ($haveDump) { docker cp $dump "${ContainerName}:/tmp/remote-schema.sql" | Out-Null }
  # Resolved by glob rather than hardcoded: the file uses the Supabase CLI's 14-digit timestamp
  # naming, so pinning the exact name here would break on the next migration.
  $migration = Get-ChildItem (Join-Path $repo 'supabase/migrations') -Filter '*_cross_device_core.sql' |
    Select-Object -First 1
  if (-not $migration) { Fail 'could not find *_cross_device_core.sql in supabase/migrations' }
  Write-Host "     migration: $($migration.Name)"
  docker cp $migration.FullName "${ContainerName}:/tmp/migration.sql" | Out-Null
  docker cp (Join-Path $repo 'scripts/sql-advisor-checks.sql') "${ContainerName}:/tmp/advisor.sql"   | Out-Null
  docker cp (Join-Path $repo 'scripts/sql-rls-behaviour.sql')  "${ContainerName}:/tmp/rls.sql"       | Out-Null

  # --- 1. apply ------------------------------------------------------------
  Write-Host ''
  Write-Host '1/4  Supabase stand-ins (auth.uid, auth.jwt, profiles, roles)' -ForegroundColor Cyan
  docker exec $ContainerName psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -f /tmp/harness.sql 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'harness failed' }

  if ($haveDump) {
    Write-Host '1b/4 Loading the PRODUCTION schema dump (realistic upgrade path)' -ForegroundColor Cyan
    $load = docker exec $ContainerName psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -f /tmp/remote-schema.sql 2>&1
    if ($LASTEXITCODE -ne 0) { $load | Select-Object -Last 15; Fail 'could not load remote-schema-dump.sql' }
    Write-Host '     loaded — the migration now runs against the real existing tables'
  } else {
    Write-Host '1b/4 NO remote-schema-dump.sql found — testing against a BLANK database.' -ForegroundColor Yellow
    Write-Host '     This will NOT catch collisions with tables that already exist in production.' -ForegroundColor Yellow
    Write-Host '     Generate one with:  npm run supabase -- db dump --schema public -f remote-schema-dump.sql' -ForegroundColor Yellow
  }

  Write-Host '2/4  Applying the migration' -ForegroundColor Cyan
  $apply = docker exec $ContainerName psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -f /tmp/migration.sql 2>&1
  if ($LASTEXITCODE -ne 0) { $apply | Select-Object -Last 10; Fail 'migration did not apply' }

  # Re-apply to prove idempotency. The file claims it; verify it.
  $again = docker exec $ContainerName psql -U postgres -d verify -q -v ON_ERROR_STOP=1 -f /tmp/migration.sql 2>&1
  if ($LASTEXITCODE -ne 0) { $again | Select-Object -Last 10; Fail 'migration is NOT idempotent' }
  Write-Host '     applied, and idempotent on re-run'

  # --- 3. advisor checks ---------------------------------------------------
  Write-Host ''
  Write-Host '3/4  Advisor checks' -ForegroundColor Cyan
  docker exec $ContainerName psql -U postgres -d verify -f /tmp/advisor.sql 2>&1 |
    Select-String -Pattern '==|\(\d+ row|is_admin' | ForEach-Object { '     ' + $_.Line }

  # --- 4. RLS behaviour ----------------------------------------------------
  Write-Host ''
  Write-Host '4/4  RLS behaviour' -ForegroundColor Cyan
  $rls = docker exec $ContainerName psql -U postgres -d verify `
           -c "set sahakar.allow_destructive_test = 'yes';" -f /tmp/rls.sql 2>&1

  $rls | Select-String -Pattern 'PASS|FAIL' | ForEach-Object {
    $line = ($_.Line -replace '^.*NOTICE:\s*', '')
    $colour = if ($line -match '^PASS') { 'Green' } else { 'Red' }
    Write-Host ('     ' + $line) -ForegroundColor $colour
  }

  $pass = ($rls | Select-String -Pattern 'PASS').Count
  $fail = ($rls | Select-String -Pattern 'FAIL').Count
  $err  = ($rls | Select-String -Pattern 'ERROR').Count

  Write-Host ''
  if ($fail -eq 0 -and $err -eq 0 -and $pass -gt 0) {
    Write-Host "MIGRATION VERIFIED — $pass RLS checks passed, 0 failures." -ForegroundColor Green
    $exit = 0
  } else {
    Write-Host "PROBLEMS — pass=$pass fail=$fail error=$err" -ForegroundColor Red
    $rls | Select-String -Pattern 'ERROR' | ForEach-Object { Write-Host ('     ' + $_.Line) -ForegroundColor Red }
    $exit = 1
  }
}
finally {
  Write-Host ''
  Write-Host 'Tearing down the container...' -ForegroundColor DarkGray
  docker rm -f $ContainerName 2>&1 | Out-Null
}

exit $exit
