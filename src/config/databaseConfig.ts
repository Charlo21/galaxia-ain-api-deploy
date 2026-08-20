import { PoolConfig } from 'pg';

function looksLikeManagedPostgres(url?: string): boolean {
  if (!url) return false;
  return /render\.com|neon\.tech|supabase\.co|amazonaws\.com|azure\.com|digitalocean\.com/i.test(url);
}

/** Supports DATABASE_URL (Railway/Render) or discrete DB_* vars. */
export function getPoolConfig(): PoolConfig {
  const url = process.env.DATABASE_URL;
  const useSsl =
    process.env.DB_SSL === 'true' ||
    (process.env.DB_SSL !== 'false' &&
      (process.env.NODE_ENV === 'production' || looksLikeManagedPostgres(url)));

  // Managed providers often use certs that Node does not trust by default in CI/local.
  const rejectUnauthorized =
    process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
      ? true
      : process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false'
        ? false
        : !looksLikeManagedPostgres(url);

  const base = {
    max: Number(process.env.DB_POOL_MAX || '20'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || '5000'),
    ssl: useSsl ? { rejectUnauthorized } : false,
  };

  if (url) {
    return {
      ...base,
      connectionString: url,
      connectionTimeoutMillis: Number(
        process.env.DB_CONNECT_TIMEOUT_MS || (looksLikeManagedPostgres(url) ? '30000' : '5000')
      ),
    };
  }

  return {
    ...base,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'galaxia',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}
