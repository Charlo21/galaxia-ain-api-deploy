/**
 * Security unit tests for Galaxia AIN hardening utilities.
 */
import { describe, it, expect } from '@jest/globals';
import { validateOutboundUrl } from '../src/security/ssrf';
import { resolveModel } from '../src/security/providerRegistry';

describe('SSRF validation', () => {
  it('blocks localhost', async () => {
    const r = await validateOutboundUrl('http://localhost/admin');
    expect(r.allowed).toBe(false);
  });

  it('blocks metadata IP', async () => {
    const r = await validateOutboundUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.allowed).toBe(false);
  });

  it('blocks file scheme', async () => {
    const r = await validateOutboundUrl('file:///etc/passwd');
    expect(r.allowed).toBe(false);
  });

  it('blocks private RFC1918', async () => {
    const r = await validateOutboundUrl('http://192.168.1.1/');
    expect(r.allowed).toBe(false);
  });
});

describe('Model allowlist', () => {
  it('rejects unknown models', () => {
    const r = resolveModel('gpt-4-attacker');
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.code).toBe('MODEL_NOT_ALLOWED');
    }
  });

  it('allows llama-3-8b when docker enabled', () => {
    const prev = process.env.DOCKER_INFERENCE_ENABLED;
    process.env.DOCKER_INFERENCE_ENABLED = 'true';
    const r = resolveModel('llama-3-8b');
    expect(r.ok).toBe(true);
    process.env.DOCKER_INFERENCE_ENABLED = prev;
  });
});
