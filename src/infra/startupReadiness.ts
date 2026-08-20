/**
 * Authoritative startup / readiness dependency checks.
 * LIVE = process alive. READY = can perform declared production responsibilities.
 */
import { pool } from '../config/database';
import { rateLimitConfigured, requireDistributedRateLimit } from './rateLimitDistributed';
import { getProviderAdapter } from '../providers/adapter';
import { initSentry, sentryActive } from './sentry';

export type DependencyState = 'LIVE' | 'READY' | 'DEGRADED' | 'BLOCKED' | 'NOT_CONFIGURED';

export type DependencyCheck = {
  name: string;
  state: DependencyState;
  required: boolean;
  detail: string;
};

async function checkPostgres(): Promise<DependencyCheck> {
  const configured = Boolean(process.env.DATABASE_URL || process.env.DB_HOST);
  if (!configured) {
    return { name: 'postgres', state: 'NOT_CONFIGURED', required: true, detail: 'DATABASE_URL/DB_HOST missing' };
  }
  try {
    const r = await pool.query('SELECT 1 AS ok');
    const tenantApplied = (process.env.TENANT_MIGRATION_APPLIED || 'false').toLowerCase() === 'true';
    if (!tenantApplied) {
      return {
        name: 'postgres',
        state: 'DEGRADED',
        required: true,
        detail: 'Connected but TENANT_MIGRATION_APPLIED !== true',
      };
    }
    return { name: 'postgres', state: 'READY', required: true, detail: 'Connected; tenant migration flagged applied' };
  } catch (e: any) {
    return { name: 'postgres', state: 'BLOCKED', required: true, detail: `Connection failed: ${e.message}` };
  }
}

async function checkRedis(): Promise<DependencyCheck> {
  if (!rateLimitConfigured()) {
    const required = (process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT || 'false').toLowerCase() === 'true';
    return {
      name: 'redis',
      state: 'NOT_CONFIGURED',
      required,
      detail: required ? 'Upstash/REDIS_URL required but not configured' : 'Redis optional — in-memory fallback',
    };
  }
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      const res = await fetch(`${url}/ping`, { headers: { Authorization: `Bearer ${token}` } });
      return {
        name: 'redis',
        state: res.ok ? 'READY' : 'DEGRADED',
        required: false,
        detail: res.ok ? 'Upstash ping OK' : `Upstash ping failed (${res.status})`,
      };
    }
    const redisUrl = process.env.REDIS_URL || process.env.RENDER_REDIS_URL;
    if (redisUrl) {
      const { createClient } = await import('redis');
      const client = createClient({ url: redisUrl });
      client.on('error', () => undefined);
      await client.connect();
      const pong = await client.ping();
      await client.quit().catch(() => undefined);
      return {
        name: 'redis',
        state: pong === 'PONG' ? 'READY' : 'DEGRADED',
        required: false,
        detail: pong === 'PONG' ? 'REDIS_URL ping OK' : 'REDIS_URL ping unexpected',
      };
    }
    return { name: 'redis', state: 'NOT_CONFIGURED', required: false, detail: 'No redis endpoint' };
  } catch (e: any) {
    return { name: 'redis', state: 'DEGRADED', required: false, detail: `Redis unreachable: ${e.message}` };
  }
}

function checkProviders(): DependencyCheck {
  const openai = getProviderAdapter('openai');
  const anthropic = getProviderAdapter('anthropic');
  const docker = getProviderAdapter('galaxia-docker');
  const openAiReady = openai.status() === 'CONFIGURED';
  const anthropicReady = anthropic.status() === 'CONFIGURED';
  const dockerReady = docker.status() !== 'NOT_CONFIGURED';
  const anyReady = openAiReady || anthropicReady || dockerReady;
  return {
    name: 'ai_providers',
    state: openAiReady || anthropicReady ? 'READY' : anyReady ? 'DEGRADED' : 'NOT_CONFIGURED',
    required: false,
    detail: openAiReady
      ? 'OpenAI configured'
      : anthropicReady
        ? 'Anthropic configured'
        : anyReady
          ? 'Docker inference path only'
          : 'No external LLM keys configured',
  };
}

function checkSentry(): DependencyCheck {
  initSentry();
  return {
    name: 'sentry',
    state: sentryActive() ? 'READY' : 'NOT_CONFIGURED',
    required: false,
    detail: sentryActive() ? 'Sentry SDK initialized' : 'SENTRY_DSN not set',
  };
}

function checkInference(): DependencyCheck {
  const docker = process.env.DOCKER_INFERENCE_ENABLED !== 'false';
  return {
    name: 'inference_runtime',
    state: docker ? 'DEGRADED' : 'NOT_CONFIGURED',
    required: false,
    detail: docker ? 'Docker inference enabled — worker health not auto-verified' : 'Docker inference disabled',
  };
}

export async function evaluateStartupReadiness(): Promise<{
  live: boolean;
  ready: boolean;
  state: DependencyState;
  checks: DependencyCheck[];
  blockers: string[];
}> {
  const checks = await Promise.all([
    checkPostgres(),
    checkRedis(),
    Promise.resolve(checkProviders()),
    Promise.resolve(checkSentry()),
    Promise.resolve(checkInference()),
  ]);

  const blockers = checks
    .filter((c) => c.required && (c.state === 'BLOCKED' || c.state === 'NOT_CONFIGURED'))
    .map((c) => `${c.name}: ${c.detail}`);

  const degraded = checks.some((c) => c.state === 'DEGRADED' || c.state === 'BLOCKED');
  const ready = blockers.length === 0 && !checks.some((c) => c.state === 'BLOCKED');

  let state: DependencyState = 'READY';
  if (blockers.length) state = 'BLOCKED';
  else if (degraded) state = 'DEGRADED';
  else if (checks.every((c) => c.state === 'NOT_CONFIGURED' || c.state === 'READY')) state = 'READY';

  return { live: true, ready, state, checks, blockers };
}

export function validateEnvironment(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (process.env.NODE_ENV === 'production') {
    if (process.env.ALLOW_DEV_AUTH === 'true') errors.push('ALLOW_DEV_AUTH must not be true in production');
    if (process.env.ALLOW_MAINNET === 'true') errors.push('ALLOW_MAINNET must not be true');
    if (!process.env.JWT_SECRET?.trim()) errors.push('JWT_SECRET is required in production');
    if (requireDistributedRateLimit() && !rateLimitConfigured()) {
      errors.push('UPSTASH credentials required when REQUIRE_DISTRIBUTED_RATE_LIMIT=true');
    }
  }
  return { ok: errors.length === 0, errors };
}
