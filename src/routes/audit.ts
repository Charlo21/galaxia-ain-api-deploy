/**
 * Galaxia Audit API Routes
 */

import { Router, Request, Response } from 'express';
import { auditService } from '../services/audit/auditService';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { optionalGalaxiaAuth } from '../middleware/galaxiaAuth';
import { verifyQuantumSignature } from '../middleware/quantumSecurity';
import { rateLimit } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../index';

const router = Router();

/**
 * POST /api/v1/audit/request
 * Request a smart contract audit
 */
router.post(
  '/request',
  optionalGalaxiaAuth,
  authenticateApiKey,
  verifyQuantumSignature,
  rateLimit,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      contractAddress,
      contractCode,
      blockchain,
      auditType,
      priority,
      complianceRequirements,
      metadata
    } = req.body;

    if (!contractCode || !blockchain || !auditType) {
      return res.status(400).json({
        error: 'Missing required fields: contractCode, blockchain, auditType'
      });
    }

    const requestingApp = req.galaxiaUser?.id || 'galaxia-ai-infrastructure';

    const result = await auditService.createAuditRequest({
      contractAddress,
      contractCode,
      blockchain,
      auditType,
      priority: priority || 'standard',
      requestedBy: requestingApp,
      complianceRequirements,
      metadata
    });

    res.json({
      success: true,
      data: result
    });
  })
);

/**
 * GET /api/v1/audit/:auditId/status
 * Get audit status
 */
router.get(
  '/:auditId/status',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { auditId } = req.params;

    const status = await auditService.getAuditStatus(auditId);

    if (!status) {
      return res.status(404).json({
        error: 'Audit not found'
      });
    }

    res.json({
      success: true,
      data: status
    });
  })
);

/**
 * GET /api/v1/audit/:auditId/report
 * Get audit report
 */
router.get(
  '/:auditId/report',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { auditId } = req.params;
    const format = (req.query.format as string) || 'json';

    const status = await auditService.getAuditStatus(auditId);

    if (!status) {
      return res.status(404).json({
        error: 'Audit not found'
      });
    }

    // Generate report
    const report = {
      auditId: status.auditId,
      blockchain: 'constellation', // Should come from audit request
      auditType: 'full', // Should come from audit request
      findings: status.findings,
      complianceScore: status.complianceScore,
      certified: status.certified,
      certificationId: status.certificationId,
      generatedAt: new Date()
    };

    if (format === 'pdf') {
      // In production, generate PDF report
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=audit-${auditId}.pdf`);
      return res.send('PDF report generation not implemented');
    }

    res.json({
      success: true,
      data: report
    });
  })
);

/**
 * GET /api/v1/audit/certification/:certificationId/verify
 * Verify audit certification
 */
router.get(
  '/certification/:certificationId/verify',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { certificationId } = req.params;

    const verification = await auditService.verifyCertification(certificationId);

    res.json({
      success: true,
      data: verification
    });
  })
);

/**
 * POST /api/v1/audit/monitor
 * Set up continuous monitoring
 */
router.post(
  '/monitor',
  authenticateApiKey,
  verifyQuantumSignature,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { contractAddress, alertThresholds, notificationEndpoint, checkInterval } = req.body;

    if (!contractAddress || !alertThresholds) {
      return res.status(400).json({
        error: 'Missing required fields: contractAddress, alertThresholds'
      });
    }

    // In production, implement monitoring service
    const monitoringId = 'monitoring-' + Date.now();

    res.json({
      success: true,
      data: { monitoringId }
    });
  })
);

export default router;
