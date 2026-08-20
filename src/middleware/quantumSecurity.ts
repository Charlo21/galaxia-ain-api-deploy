/**
 * Quantum Security Middleware
 * Applies post-quantum cryptographic security to API requests
 */

import { Request, Response, NextFunction } from 'express';
import { quantumSecurityService } from '../services/galaxia/quantumSecurity';
import { logger } from '../index';
import { SignatureVerifier } from '../services/crypto/signatureVerifier';

/**
 * Verify quantum-resistant signatures for sensitive operations
 */
export async function verifyQuantumSignature(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // WHY: Route verification through a scheme-aware verifier that supports
    // both legacy signatures and PQ+SNARK proofs during the migration window.
    const result = await SignatureVerifier.verifyRequest(req);
    const isValid = result.ok;
    
    if (!isValid) {
      const publicKey = (req.headers['x-quantum-public-key'] as string | undefined) || '';
      logger.warn('Invalid quantum signature', {
        path: req.path,
        scheme: result.schemeTried,
        reason: result.reason,
        publicKey: publicKey ? publicKey.substring(0, 20) + '...' : undefined,
      });
      
      res.status(401).json({
        error: 'Invalid signature',
        code: 'QUANTUM_SIGNATURE_INVALID',
        request_id: (req as any).id,
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error('Quantum signature verification error', {
      error: error.message,
      path: req.path,
    });
    
    // WHY: During PQ migration, sensitive routes should be able to fail-closed.
    // Quantum threat mitigated: prevents bypass when verification infrastructure errors.
    const requirePq = (process.env.REQUIRE_PQ_SIGNATURE || 'false').toLowerCase() === 'true';
    if (requirePq) {
      res.status(503).json({
        error: 'Signature verification unavailable',
        code: 'SIGNATURE_VERIFICATION_UNAVAILABLE',
        request_id: (req as any).id,
      });
      return;
    }

    // Legacy behavior: graceful degradation
    next();
  }
}

/**
 * Require quantum signature for sensitive operations
 */
export function requireQuantumSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signature = req.headers['x-quantum-signature'];
  
  if (!signature) {
    res.status(401).json({
      error: 'Quantum signature required for this operation',
      code: 'QUANTUM_SIGNATURE_REQUIRED',
      request_id: (req as any).id,
    });
    return;
  }
  
  verifyQuantumSignature(req, res, next);
}

