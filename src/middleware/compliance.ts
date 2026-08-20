/**
 * Compliance Middleware
 * Geo-blocking, KYC verification, and compliance checks
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { isGeoBlocked, getUserJurisdiction } from '../services/compliance/jurisdictionService';
import { isKYCRequired, getKYCProfile } from '../services/compliance/kycService';
import { pool } from '../config/database';

/**
 * Geo-blocking middleware
 * Blocks requests from restricted jurisdictions
 */
export async function geoBlockingMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId;
    
    if (!userId) {
      // Allow unauthenticated requests to pass (they'll be handled by auth middleware)
      return next();
    }

    const blocked = await isGeoBlocked(userId);
    
    if (blocked) {
      const jurisdiction = await getUserJurisdiction(userId);
      res.status(403).json({
        error: 'Service not available in your jurisdiction',
        jurisdiction: jurisdiction?.detected_country,
        reason: jurisdiction?.jurisdiction_status === 'requires_license' 
          ? 'License required in your jurisdiction'
          : 'Service restricted in your jurisdiction'
      });
      return;
    }

    next();
  } catch (error) {
    // On error, allow request to proceed (fail open for availability)
    console.error('Geo-blocking check failed:', error);
    next();
  }
}

/**
 * KYC verification middleware
 * Checks if KYC is required and verified before allowing transactions
 */
export async function kycVerificationMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return next();
    }

    // Check if this is a transaction endpoint
    const isTransactionEndpoint = 
      req.path.includes('/payment') ||
      req.path.includes('/transaction') ||
      req.path.includes('/inference') ||
      req.method === 'POST' && (req.path.includes('/tasks') || req.path.includes('/transfer'));

    if (!isTransactionEndpoint) {
      return next();
    }

    // Get transaction amount from body or query
    const amount = parseFloat(req.body?.amount || req.query?.amount || '0');

    if (amount > 0) {
      const kycRequired = await isKYCRequired(userId, amount);
      
      if (kycRequired) {
        const profile = await getKYCProfile(userId);
        
        res.status(403).json({
          error: 'KYC verification required',
          kyc_status: profile?.kyc_status || 'none',
          kyc_level: profile?.kyc_level || 'none',
          amount,
          required_for_amount: true
        });
        return;
      }
    }

    next();
  } catch (error) {
    console.error('KYC verification check failed:', error);
    // On error, allow request to proceed (fail open)
    next();
  }
}

/**
 * Compliance audit logging middleware
 * Logs all compliance-relevant actions
 */
export async function complianceAuditMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId;
    const apiKeyId = req.apiKeyId;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || '';
    const userAgent = req.headers['user-agent'] || '';

    // Determine if action is compliance-relevant
    const complianceRelevantPaths = [
      '/compliance/',
      '/payment',
      '/transaction',
      '/kyc',
      '/complaints'
    ];

    const isComplianceRelevant = complianceRelevantPaths.some(path => 
      req.path.includes(path)
    );

    if (isComplianceRelevant && userId) {
      // Log to audit trail
      await pool.query(
        `INSERT INTO audit_logs
           (id, user_id, api_key_id, ip_address, user_agent,
            action_type, resource_type, resource_id,
            action_description, request_data, compliance_relevant,
            session_id, request_id, created_at)
         VALUES
           (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, CURRENT_TIMESTAMP)`,
        [
          userId,
          apiKeyId || null,
          ipAddress,
          userAgent,
          `${req.method} ${req.path}`,
          'api_request',
          null,
          `API request to ${req.path}`,
          JSON.stringify({
            method: req.method,
            path: req.path,
            query: req.query,
            // Don't log sensitive data
            body_keys: req.body ? Object.keys(req.body) : []
          }),
          req.headers['x-session-id'] || null,
          req.headers['x-request-id'] || null
        ]
      );
    }

    next();
  } catch (error) {
    // Don't block request on audit logging failure
    console.error('Audit logging failed:', error);
    next();
  }
}

/**
 * Transaction limit check middleware
 * Enforces transaction limits based on KYC tier
 */
export async function transactionLimitMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return next();
    }

    // Check if this is a transaction endpoint
    const isTransactionEndpoint = 
      req.path.includes('/payment') ||
      req.path.includes('/transaction') ||
      (req.method === 'POST' && req.path.includes('/inference'));

    if (!isTransactionEndpoint) {
      return next();
    }

    const amount = parseFloat(req.body?.amount || req.query?.amount || '0');

    if (amount > 0) {
      const profile = await getKYCProfile(userId);
      
      if (profile) {
        const singleLimit = parseFloat(String(profile.single_transaction_limit || '0'));
        
        if (singleLimit > 0 && amount > singleLimit) {
          res.status(403).json({
            error: 'Transaction exceeds limit',
            amount,
            limit: singleLimit,
            kyc_tier: profile.verification_tier,
            kyc_level: profile.kyc_level
          });
          return;
        }

        // Check daily limit
        const dailyResult = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) as daily_total
           FROM token_transactions
           WHERE user_id = $1
             AND transaction_type = 'payment'
             AND created_at::date = CURRENT_DATE
             AND status = 'completed'`,
          [userId]
        );

        const dailyTotal = parseFloat(dailyResult.rows[0].daily_total || '0');
        const dailyLimit = parseFloat(String(profile.daily_limit || '0'));

        if (dailyLimit > 0 && (dailyTotal + amount) > dailyLimit) {
          res.status(403).json({
            error: 'Daily transaction limit exceeded',
            amount,
            daily_total: dailyTotal,
            daily_limit: dailyLimit,
            remaining: dailyLimit - dailyTotal
          });
          return;
        }
      }
    }

    next();
  } catch (error) {
    console.error('Transaction limit check failed:', error);
    next();
  }
}

/**
 * Combined compliance middleware
 * Applies all compliance checks in order
 */
export const complianceMiddleware = [
  geoBlockingMiddleware,
  kycVerificationMiddleware,
  transactionLimitMiddleware,
  complianceAuditMiddleware
];

