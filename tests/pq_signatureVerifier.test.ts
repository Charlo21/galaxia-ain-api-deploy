import { describe, test, expect, beforeEach } from '@jest/globals';

// We unit test routing/anti-confusion logic; cryptographic correctness is delegated to audited libs.
import { SignatureVerifier } from '../src/services/crypto/signatureVerifier';

describe('PQ SignatureVerifier (migration window)', () => {
  const baseReq: any = {
    method: 'POST',
    path: '/api/v1/audit/request',
    body: { hello: 'world' },
    headers: {},
  };

  beforeEach(() => {
    delete process.env.PQ_SNARK_ENABLED;
    delete process.env.REQUIRE_PQ_SIGNATURE;
    delete process.env.PQ_SNARK_MAX_SKEW_MS;
    delete process.env.PQ_SNARK_VK_PATH;
  });

  test('allows missing signature by default', async () => {
    const res = await SignatureVerifier.verifyRequest({ ...baseReq, headers: {} } as any);
    expect(res.ok).toBe(true);
  });

  test('rejects malformed PQ header when PQ enabled', async () => {
    process.env.PQ_SNARK_ENABLED = 'true';
    const res = await SignatureVerifier.verifyRequest({
      ...baseReq,
      headers: { 'x-pq-snark-signature': '{not-json' },
    } as any);
    expect(res.ok).toBe(false);
    expect(res.schemeTried).toBe('pq-snark');
  });

  test('rejects PQ signature with excessive timestamp skew (replay defense)', async () => {
    process.env.PQ_SNARK_ENABLED = 'true';
    process.env.PQ_SNARK_MAX_SKEW_MS = '10';
    const res = await SignatureVerifier.verifyRequest({
      ...baseReq,
      headers: {
        'x-pq-snark-signature': JSON.stringify({
          scheme: 'dilithium',
          proof: {},
          publicSignals: [],
          pqPublicKey: 'pqpk',
          domain: 'galaxia-request-v1',
          timestamp: Date.now() - 999999,
        }),
      },
    } as any);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Timestamp skew/);
  });

  test('cross-scheme confusion: PQ enabled but legacy headers present -> legacy path used when no PQ header', async () => {
    process.env.PQ_SNARK_ENABLED = 'true';
    const res = await SignatureVerifier.verifyRequest({
      ...baseReq,
      headers: {
        'x-quantum-signature': 'deadbeef',
        'x-quantum-public-key': 'pubkey',
        'x-quantum-algorithm': 'CRYSTALS-Dilithium',
        'x-quantum-timestamp': Date.now().toString(),
      },
    } as any);
    // We don't assert ok here because it depends on external verification;
    // we assert that we tried the legacy scheme rather than mis-parsing as PQ.
    expect(res.schemeTried).toBe('legacy-quantum-header');
  });
});

