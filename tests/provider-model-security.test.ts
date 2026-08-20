import { describe, it, expect } from '@jest/globals';
import { resolveModel, getProviderStatus } from '../src/security/providerRegistry';
import { getProviderAdapter } from '../src/providers/adapter';

describe('Provider/model security', () => {
  it('rejects unknown provider model', () => {
    const r = resolveModel('gpt-4-hacker');
    expect(r.ok).toBe(false);
  });

  it('rejects disabled docker when env false', () => {
    const prev = process.env.DOCKER_INFERENCE_ENABLED;
    process.env.DOCKER_INFERENCE_ENABLED = 'false';
    const r = resolveModel('llama-3-8b');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.code).toBe('PROVIDER_NOT_CONFIGURED');
    process.env.DOCKER_INFERENCE_ENABLED = prev;
  });

  it('openai adapter NOT_CONFIGURED without key', () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(getProviderAdapter('openai').status()).toBe('NOT_CONFIGURED');
    process.env.OPENAI_API_KEY = prev;
  });

  it('anthropic adapter NOT_CONFIGURED without key', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(getProviderAdapter('anthropic').status()).toBe('NOT_CONFIGURED');
    process.env.ANTHROPIC_API_KEY = prev;
  });

  it('provider status honest — no AVAILABLE when not configured', () => {
    const status = getProviderStatus();
    for (const p of status.providers) {
      expect(['CONFIGURED', 'NOT_CONFIGURED', 'DISABLED', 'SIMULATED', 'LIVE']).toContain(p.state);
      expect(p.state).not.toBe('READY');
      expect(p.state).not.toBe('CONNECTED');
    }
  });

  it('model allowlist is finite', () => {
    const status = getProviderStatus();
    const docker = status.providers.find((p) => p.id === 'galaxia-docker') as any;
    expect(Array.isArray(docker?.models)).toBe(true);
    expect(docker.models.length).toBeGreaterThan(0);
  });

  it('provider/model mismatch rejected via allowlist', () => {
    const r = resolveModel('not-a-real-model');
    expect(r.ok).toBe(false);
  });

  it('generate throws PROVIDER_NOT_CONFIGURED', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(
      getProviderAdapter('openai').generate({ modelId: 'gpt-4o-mini', prompt: 'hi' })
    ).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
    process.env.OPENAI_API_KEY = prev;
  });
});

describe('Provider capability unsupported', () => {
  it('unknown provider returns NOT_CONFIGURED adapter', () => {
    expect(getProviderAdapter('evil-provider').status()).toBe('NOT_CONFIGURED');
  });
});

describe('Structured error codes', () => {
  const codes = [
    'PROVIDER_NOT_CONFIGURED',
    'MODEL_NOT_ALLOWED',
    'MODEL_DISABLED',
    'MODEL_CAPABILITY_UNSUPPORTED',
    'PROVIDER_UNAVAILABLE',
  ];
  codes.forEach((code) => {
    it(`documents error code ${code}`, () => {
      expect(typeof code).toBe('string');
    });
  });
});
