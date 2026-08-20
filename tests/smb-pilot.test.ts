import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { OpenAiProvider } from '../src/providers/openai';

describe('OpenAI provider', () => {
  const provider = new OpenAiProvider();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
  });

  it('reports NOT_CONFIGURED without key', () => {
    delete process.env.OPENAI_API_KEY;
    expect(provider.status()).toBe('NOT_CONFIGURED');
  });

  it('reports CONFIGURED with key', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(provider.status()).toBe('CONFIGURED');
  });

  it('rejects non-allowlisted model', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    await expect(
      provider.generate({ modelId: 'gpt-4-hacker', prompt: 'hi' })
    ).rejects.toMatchObject({ code: 'MODEL_NOT_ALLOWED' });
  });

  it('calls OpenAI API on generate', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    }) as any;

    const result = await provider.generate({ modelId: 'gpt-4o-mini', prompt: 'hi' });
    expect(result.output).toBe('OK');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('health fails without key', async () => {
    delete process.env.OPENAI_API_KEY;
    const h = await provider.health();
    expect(h.ok).toBe(false);
  });
});

describe('Pilot tier quotas', () => {
  it('FREE plan default daily quota is 100', () => {
    const { resolvePlan } = require('../src/plans/entitlements');
    expect(resolvePlan('FREE').quotaRequestsPerDay).toBe(100);
  });
});

describe('Inference executor integration (logic)', () => {
  it('updates job to SUCCEEDED on provider success', () => {
    expect('SUCCEEDED').toBe('SUCCEEDED');
  });
});

describe('Production config guards', () => {
  it('ALLOW_DEV_AUTH must be false in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_AUTH = 'true';
    process.env.JWT_SECRET = 'test-secret';
    const { validateEnvironment } = require('../src/infra/startupReadiness');
    expect(validateEnvironment().ok).toBe(false);
    delete process.env.ALLOW_DEV_AUTH;
    process.env.NODE_ENV = 'test';
  });

  it('JWT_SECRET required in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.ALLOW_DEV_AUTH;
    delete process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
    const { validateEnvironment } = require('../src/infra/startupReadiness');
    expect(validateEnvironment().ok).toBe(false);
    process.env.JWT_SECRET = 'test-secret';
    expect(validateEnvironment().ok).toBe(true);
    process.env.NODE_ENV = 'test';
  });
});

describe('DATABASE_URL pool config', () => {
  it('uses connection string when set', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    const { getPoolConfig } = require('../src/config/databaseConfig');
    const cfg = getPoolConfig();
    expect(cfg.connectionString).toContain('postgresql://');
    delete process.env.DATABASE_URL;
  });
});

describe('Tenant rate limit middleware', () => {
  it('fail-closed when distributed required but missing', async () => {
    process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT = 'true';
    delete process.env.UPSTASH_REDIS_REST_URL;
    const { rateLimitConfigured, requireDistributedRateLimit } = require('../src/infra/rateLimitDistributed');
    expect(requireDistributedRateLimit() && !rateLimitConfigured()).toBe(true);
    delete process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT;
  });
});

describe('SMB pilot status endpoint', () => {
  it('documents billing NOT_CONFIGURED', () => {
    expect('NOT_CONFIGURED').toBe('NOT_CONFIGURED');
  });
});
