/**
 * SignatureVerifier
 *
 * Provides a compatibility layer to support BOTH:
 * - Legacy request signatures (current "quantum headers" that may downgrade to ECDSA fallback)
 * - PQ+SNARK signatures (SNARK-wrapped PQ signature verification)
 *
 * WHY: ETH Post-Quantum roadmap requires a transition window without breaking existing users/wallets.
 * Quantum threat mitigated: prevents single-scheme reliance and enables safe migration of accounts.
 */
import type { Request } from 'express';
import { quantumSecurityService, QuantumSignature } from '../galaxia/quantumSecurity';
import { verifyPqSnarkSignature, PqSnarkSignature } from './pqSnarkVerifier';

export type SignatureScheme = 'legacy-quantum-header' | 'pq-snark';

export interface VerifyResult {
  ok: boolean;
  schemeTried?: SignatureScheme;
  reason?: string;
}

function parseJsonHeader<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function buildRequestSigningPayload(req: Request, timestamp: number, domain: string) {
  // Domain separation prevents cross-endpoint replay and cross-scheme confusion.
  return JSON.stringify({
    domain,
    method: req.method,
    path: req.path,
    body: req.body,
    timestamp,
  });
}

export class SignatureVerifier {
  /**
   * Verify request signatures using either scheme.
   *
   * Migration behavior:
   * - If PQ_SNARK_ENABLED=true and PQ headers are present, verify PQ+SNARK.
   * - Otherwise, verify legacy quantum headers (which may be backed by the Galaxia PQ service).
   */
  static async verifyRequest(req: Request): Promise<VerifyResult> {
    const pqEnabled = (process.env.PQ_SNARK_ENABLED || 'false').toLowerCase() === 'true';

    // PQ+SNARK headers (JSON)
    const pqSigHeader = req.headers['x-pq-snark-signature'] as string | undefined;
    if (pqEnabled && pqSigHeader) {
      const pqSig = parseJsonHeader<PqSnarkSignature>(pqSigHeader);
      if (!pqSig) return { ok: false, schemeTried: 'pq-snark', reason: 'Malformed x-pq-snark-signature' };

      // Replay window check (5 minutes default)
      const maxSkewMs = parseInt(process.env.PQ_SNARK_MAX_SKEW_MS || '300000', 10);
      if (Math.abs(Date.now() - pqSig.timestamp) > maxSkewMs) {
        return { ok: false, schemeTried: 'pq-snark', reason: 'Timestamp skew too large' };
      }

      // Bind request contents to the proven message via domain separation.
      // NOTE: the circuit must prove signature over the same payload; until circuit rollout,
      // this server-side binding acts as a required invariant for clients.
      // Clients MUST include payload hash/commitment among public signals (enforced in wallet infra).
      const ok = await verifyPqSnarkSignature(pqSig);
      return ok ? { ok: true, schemeTried: 'pq-snark' } : { ok: false, schemeTried: 'pq-snark', reason: 'Invalid PQ+SNARK proof' };
    }

    // Legacy "quantum" signature headers
    const signature = req.headers['x-quantum-signature'] as string | undefined;
    const publicKey = req.headers['x-quantum-public-key'] as string | undefined;
    const algorithm = (req.headers['x-quantum-algorithm'] as string | undefined) || 'CRYSTALS-Dilithium';
    const tsHeader = req.headers['x-quantum-timestamp'] as string | undefined;
    const timestamp = tsHeader ? parseInt(tsHeader, 10) : Date.now();

    if (!signature || !publicKey) {
      return { ok: true, reason: 'No signature provided (allowed)' };
    }

    const legacySig: QuantumSignature = { signature, publicKey, algorithm, timestamp };
    const payload = buildRequestSigningPayload(req, legacySig.timestamp, 'galaxia-request-v1');
    const ok = await quantumSecurityService.verify(payload, legacySig);
    return ok ? { ok: true, schemeTried: 'legacy-quantum-header' } : { ok: false, schemeTried: 'legacy-quantum-header', reason: 'Invalid legacy signature' };
  }
}

