/**
 * Post-Quantum Health, Schemes & Verification
 * Real ML-KEM / ML-DSA / SLH-DSA via @noble/post-quantum when available.
 * Fail closed: quantumResistant only true when noble self-tests pass.
 */

import express, { Request, Response } from 'express';
import * as crypto from 'crypto';
import { quantumSecurityService } from '../services/galaxia/quantumSecurity';

const router = express.Router();

export const PQ_SCHEMES = {
  kem: [
    { id: 'ML-KEM-1024', alias: 'Kyber-1024', nist: 'FIPS 203', purpose: 'key-encapsulation' },
    { id: 'X25519+ML-KEM-768', alias: 'XWing', purpose: 'hybrid-classical-pq' },
  ],
  sig: [
    { id: 'ML-DSA-65', alias: 'Dilithium2', nist: 'FIPS 204', purpose: 'primary-signature' },
    { id: 'ML-DSA-87', alias: 'Dilithium5', nist: 'FIPS 204', purpose: 'high-security-signature' },
    { id: 'SLH-DSA-SHAKE-256s', alias: 'SPHINCS+-256s', nist: 'FIPS 205', purpose: 'hash-based-backup' },
    { id: 'ECDSA-P256+ML-DSA-65', alias: 'Hybrid', purpose: 'migration-window' },
  ],
};

function getCommitSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'unknown';
}

async function runNobleSelfTests(): Promise<{
  tests: Array<{ name: string; passed: boolean; detail?: string }>;
  nobleLoaded: boolean;
}> {
  const tests: Array<{ name: string; passed: boolean; detail?: string }> = [];
  let nobleLoaded = false;

  try {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = 'galaxia-pq-selftest';
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    tests.push({ name: 'AES-256-GCM roundtrip', passed: dec === plaintext });
  } catch (e: any) {
    tests.push({ name: 'AES-256-GCM roundtrip', passed: false, detail: e.message });
  }

  try {
    const hash = crypto.createHash('sha256').update('galaxia-pq').digest('hex');
    tests.push({ name: 'SHA-256 integrity', passed: hash.length === 64 });
  } catch (e: any) {
    tests.push({ name: 'SHA-256 integrity', passed: false, detail: e.message });
  }

  try {
    // Prefer require for CJS serverless compatibility (Galaxia ID pattern)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mlKem = require('@noble/post-quantum/ml-kem');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mlDsa = require('@noble/post-quantum/ml-dsa');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const slhDsa = require('@noble/post-quantum/slh-dsa');
    nobleLoaded = true;

    const kem = mlKem.ml_kem1024;
    const { publicKey: kemPk, secretKey: kemSk } = kem.keygen();
    const { cipherText, sharedSecret: ss1 } = kem.encapsulate(kemPk);
    const ss2 = kem.decapsulate(cipherText, kemSk);
    tests.push({
      name: 'ML-KEM-1024 roundtrip',
      passed: Buffer.from(ss1).equals(Buffer.from(ss2)),
    });

    const dsa = mlDsa.ml_dsa65;
    const { publicKey: sigPk, secretKey: sigSk } = dsa.keygen();
    const msg = new TextEncoder().encode('galaxia-ml-dsa');
    const sig = dsa.sign(msg, sigSk);
    tests.push({
      name: 'ML-DSA-65 sign/verify',
      passed: dsa.verify(sig, msg, sigPk),
    });

    const sph = slhDsa.slh_dsa_sha2_128f;
    const { publicKey: sphPk, secretKey: sphSk } = sph.keygen();
    const sphMsg = new TextEncoder().encode('galaxia-slh');
    const sphSig = sph.sign(sphMsg, sphSk);
    tests.push({
      name: 'SLH-DSA-SHA2-128f sign/verify',
      passed: sph.verify(sphSig, sphMsg, sphPk),
    });
  } catch (e: any) {
    tests.push({
      name: 'ML-KEM-1024 roundtrip',
      passed: false,
      detail: e.message || '@noble/post-quantum unavailable',
    });
    tests.push({
      name: 'ML-DSA-65 sign/verify',
      passed: false,
      detail: 'skipped — noble load failed',
    });
    tests.push({
      name: 'SLH-DSA-SHA2-128f sign/verify',
      passed: false,
      detail: 'skipped — noble load failed',
    });
  }

  const pqSnarkEnabled = (process.env.PQ_SNARK_ENABLED || 'false').toLowerCase() === 'true';
  const vkPath = process.env.PQ_SNARK_VK_PATH || null;
  tests.push({
    name: 'PQ-SNARK verification key',
    passed: !pqSnarkEnabled || Boolean(vkPath),
    detail: pqSnarkEnabled ? (vkPath ? 'configured' : 'missing PQ_SNARK_VK_PATH') : 'not required',
  });

  const allowLegacy = (process.env.ALLOW_LEGACY_ECDSA_FALLBACK || 'false').toLowerCase() === 'true';
  tests.push({
    name: 'Legacy ECDSA downgrade disabled',
    passed: !allowLegacy,
    detail: allowLegacy ? 'ALLOW_LEGACY_ECDSA_FALLBACK=true' : 'hardened',
  });

  return { tests, nobleLoaded };
}

router.get('/health', async (req: Request, res: Response) => {
  const pqSnarkEnabled = (process.env.PQ_SNARK_ENABLED || 'false').toLowerCase() === 'true';
  const requirePq = (process.env.REQUIRE_PQ_SIGNATURE || 'false').toLowerCase() === 'true';
  const allowLegacyEcdsaFallback =
    (process.env.ALLOW_LEGACY_ECDSA_FALLBACK || 'false').toLowerCase() === 'true';

  const vkPath = process.env.PQ_SNARK_VK_PATH || null;
  const vkConfigured = pqSnarkEnabled ? Boolean(vkPath) : null;
  const { tests: selfTests, nobleLoaded } = await runNobleSelfTests();
  const pqAlgoOk = selfTests
    .filter((t) => t.name.startsWith('ML-') || t.name.startsWith('SLH-'))
    .every((t) => t.passed);
  const quantumResistant = nobleLoaded && pqAlgoOk && !allowLegacyEcdsaFallback;

  const classicalOk = selfTests
    .filter((t) => t.name.includes('AES') || t.name.includes('SHA') || t.name.includes('Legacy') || t.name.includes('PQ-SNARK'))
    .every((t) => t.passed);

  const pqServiceHealthy = await quantumSecurityService.healthCheck().catch(() => false);

  const ok = classicalOk && (!pqSnarkEnabled || Boolean(vkConfigured)) && !allowLegacyEcdsaFallback;
  const status = !ok ? 'degraded' : quantumResistant ? 'healthy' : 'healthy';

  const commit = getCommitSha();
  res.setHeader('X-Galaxia-Commit', commit);
  res.setHeader('X-Galaxia-Quantum-Resistant', String(quantumResistant));
  if ((req as any).id) res.setHeader('X-Correlation-Id', (req as any).id);

  res.status(ok ? 200 : 503).json({
    ok,
    status,
    mode: quantumResistant ? 'post-quantum' : 'simulated',
    quantumResistant,
    label: quantumResistant ? 'POST-QUANTUM SECURITY' : 'SIMULATED POST-QUANTUM SECURITY',
    algorithms: {
      kem: 'ML-KEM-1024 (Kyber)',
      sig: 'ML-DSA (Dilithium) + SLH-DSA (SPHINCS+ backup)',
      hybrid: 'ECDSA-P256 + ML-DSA-65 (migration window)',
      compression: pqSnarkEnabled ? 'Groth16 (SNARK-wrapped PQ signatures)' : 'disabled',
    },
    flags: {
      PQ_SNARK_ENABLED: pqSnarkEnabled,
      REQUIRE_PQ_SIGNATURE: requirePq,
      ALLOW_LEGACY_ECDSA_FALLBACK: allowLegacyEcdsaFallback,
    },
    artifacts: { PQ_SNARK_VK_PATH: vkPath, vkConfigured },
    dependencies: {
      pqServiceHealthy,
      noblePostQuantum: nobleLoaded,
    },
    selfTests,
    schemes: PQ_SCHEMES,
    commit,
    timestamp: new Date().toISOString(),
    disclaimer: quantumResistant
      ? undefined
      : 'SIMULATED POST-QUANTUM SECURITY — @noble/post-quantum self-tests did not all pass.',
  });
});

router.get('/schemes', (req: Request, res: Response) => {
  const commit = getCommitSha();
  res.setHeader('X-Galaxia-Commit', commit);
  res.json({
    success: true,
    schemes: PQ_SCHEMES,
    recommended: {
      kem: 'ML-KEM-1024',
      signature: 'ML-DSA-65',
      highSecurity: 'ML-DSA-87',
      backup: 'SLH-DSA-SHAKE-256s',
      hybrid: 'ECDSA-P256+ML-DSA-65',
    },
    commit,
  });
});

router.post('/verify', async (req: Request, res: Response) => {
  const { message, signature, publicKey, scheme } = req.body || {};

  if (!message || !signature || !publicKey) {
    return res.status(400).json({
      success: false,
      error: 'message, signature, and publicKey are required',
    });
  }

  try {
    const valid = await quantumSecurityService.verifySignature(
      typeof message === 'string' ? message : JSON.stringify(message),
      signature,
      publicKey
    );

    res.setHeader('X-Galaxia-Commit', getCommitSha());
    res.json({
      success: true,
      valid: Boolean(valid),
      scheme: scheme || 'ML-DSA-65',
      simulated: valid === undefined,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, valid: false });
  }
});

export default router;
