#!/bin/sh
set -e

echo "Galaxia AIN api-server — startup entrypoint"

PSQL_OPTS="-v ON_ERROR_STOP=1"
if [ "${NODE_ENV:-}" != "production" ]; then
  PSQL_OPTS="-v ON_ERROR_STOP=0"
fi

run_migrations() {
  if [ -n "$DATABASE_URL" ]; then
    echo "Applying migrations via DATABASE_URL..."
    for f in database/schema.sql database/migrations/add_tenant_security.sql database/migrations/add_production_hardening.sql database/migrations/add_free_tier_plans.sql database/migrations/force_rls_for_owners.sql database/migrations/fix_rls_bootstrap_guc.sql; do
      if [ -f "$f" ]; then
        echo "Applying $f"
        psql "$DATABASE_URL" $PSQL_OPTS -f "$f" || {
          if [ "$NODE_ENV" = "production" ]; then exit 1; fi
        }
      fi
    done
    return
  fi

  echo "Waiting for Postgres (${DB_HOST:-postgres})..."
  until pg_isready -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" > /dev/null 2>&1; do
    sleep 1
  done

  echo "Running migrations via discrete DB_* vars..."
  export PGPASSWORD="${DB_PASSWORD:-postgres}"
  PGHOST="${DB_HOST:-postgres}"
  PGPORT="${DB_PORT:-5432}"
  PGUSER="${DB_USER:-postgres}"
  PGDATABASE="${DB_NAME:-galaxia}"

  for f in database/schema.sql database/migrations/add_tenant_security.sql database/migrations/add_production_hardening.sql database/migrations/add_free_tier_plans.sql database/migrations/force_rls_for_owners.sql database/migrations/fix_rls_bootstrap_guc.sql; do
    if [ -f "$f" ]; then
      echo "Applying $f"
      psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" $PSQL_OPTS -f "$f" || {
        if [ "$NODE_ENV" = "production" ]; then exit 1; fi
      }
    fi
  done
}

verify_tenant_schema() {
  local count=0
  if [ -n "$DATABASE_URL" ]; then
    count=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'" 2>/dev/null || echo 0)
  else
    export PGPASSWORD="${DB_PASSWORD:-postgres}"
    count=$(psql -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-postgres}" -d "${DB_NAME:-galaxia}" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'" 2>/dev/null || echo 0)
  fi
  count=$(echo "$count" | tr -d '[:space:]')
  if [ "$count" != "1" ]; then
    echo "ERROR: organizations table not found after migrations (count=$count)"
    if [ "$NODE_ENV" = "production" ]; then exit 1; fi
    export TENANT_MIGRATION_APPLIED=false
    return
  fi
  export TENANT_MIGRATION_APPLIED=true
  echo "Tenant schema verified — TENANT_MIGRATION_APPLIED=true"
}

run_migrations
verify_tenant_schema

echo "Starting api-server..."
exec node dist/index.js
