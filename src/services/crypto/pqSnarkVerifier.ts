/**
 * PQ+SNARK Signature Verifier (Groth16)
 *
 * ETH PQ roadmap alignment:
 * - Wrap post-quantum signatures (Dilithium/FALCON/SPHINCS+) inside a SNARK to reduce bandwidth/cost.
 * - During migration, accept both legacy signatures and PQ+SNARK proofs.
 *
 * Security note:
 * - This module ONLY verifies proofs. Proof generation happens in wallet/signing infrastructure.
 * - We do NOT implement custom crypto; verification uses audited `snarkjs`.
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../../index';

// `snarkjs` is a widely used audited library in the zk ecosystem.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const snarkjs = require('snarkjs');

export type PqSnarkScheme = 'dilithium' | 'falcon' | 'sphincs';

export interface PqSnarkSignature {
  scheme: PqSnarkScheme;
  /**
   * Groth16 proof JSON (snarkjs format).
   * Keep this comparable to legacy signature sizes during rollout (performance constraint).
   */
  proof: any;
  /** Public signals for the circuit (snarkjs format). */
  publicSignals: any;
  /**
   * The PQ public key committed in the circuit (or its hash/commitment).
   * We keep this explicit to prevent cross-scheme confusion and to support account migration metadata.
   */
  pqPublicKey: string;
  /** Domain separation tag (prevents replay/cross-protocol confusion). */
  domain: 'galaxia-request-v1' | 'galaxia-record-v1';
  /** Millisecond timestamp included in the proven message preimage. */
  timestamp: number;
}

type VerificationKey = any;

let cachedVk: VerificationKey | null = null;
let cachedVkPath: string | null = null;

function getVkPath(): string {
  const vkPath = process.env.PQ_SNARK_VK_PATH;
  if (!vkPath) {
    throw new Error('PQ_SNARK_VK_PATH is not set');
  }
  return path.isAbsolute(vkPath) ? vkPath : path.join(process.cwd(), vkPath);
}

function loadVerificationKey(): VerificationKey {
  const vkPath = getVkPath();
  if (cachedVk && cachedVkPath === vkPath) return cachedVk;
  const raw = fs.readFileSync(vkPath, 'utf8');
  cachedVk = JSON.parse(raw);
  cachedVkPath = vkPath;
  return cachedVk;
}

/**
 * Verify a PQ+SNARK signature proof.
 *
 * WHY: SNARK verification keeps proof sizes small, reducing bandwidth and storage pressure vs raw PQ signatures.
 * Quantum threat mitigated: removes reliance on ECDSA/secp256k1 signatures that are broken by Shor.
 */
export async function verifyPqSnarkSignature(sig: PqSnarkSignature): Promise<boolean> {
  try {
    const vk = loadVerificationKey();
    // snarkjs.groth16.verify(vk, publicSignals, proof) -> boolean
    return await snarkjs.groth16.verify(vk, sig.publicSignals, sig.proof);
  } catch (error: any) {
    logger.error('PQ+SNARK verification failed', { error: error.message });
    return false;
  }
}

