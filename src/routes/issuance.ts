/**
 * Galaxia Issuance API Routes
 */

import { Router, Request, Response } from 'express';
import { issuanceService } from '../services/issuance/issuanceService';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { optionalGalaxiaAuth } from '../middleware/galaxiaAuth';
import { verifyQuantumSignature } from '../middleware/quantumSecurity';
import { rateLimit } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../index';

const router = Router();

/**
 * POST /api/v1/issuance/offering
 * Create a new securities offering
 */
router.post(
  '/offering',
  optionalGalaxiaAuth,
  authenticateApiKey,
  verifyQuantumSignature,
  rateLimit,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      offeringType,
      securityType,
      issuerDetails,
      offeringAmount,
      tokenDetails,
      auditCertificationId,
      complianceDocuments,
      metadata
    } = req.body;

    if (!offeringType || !securityType || !issuerDetails || !offeringAmount || !tokenDetails || !auditCertificationId) {
      return res.status(400).json({
        error: 'Missing required fields: offeringType, securityType, issuerDetails, offeringAmount, tokenDetails, auditCertificationId'
      });
    }

    const offering = await issuanceService.createOffering({
      offeringType,
      securityType,
      issuerDetails,
      offeringAmount,
      tokenDetails,
      auditCertificationId,
      complianceDocuments,
      metadata
    });

    res.json({
      success: true,
      data: offering
    });
  })
);

/**
 * GET /api/v1/issuance/offering/:offeringId
 * Get offering details
 */
router.get(
  '/offering/:offeringId',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { offeringId } = req.params;

    const offering = await issuanceService.getOffering(offeringId);

    if (!offering) {
      return res.status(404).json({
        error: 'Offering not found'
      });
    }

    res.json({
      success: true,
      data: offering
    });
  })
);

/**
 * POST /api/v1/issuance/accreditation/verify
 * Verify investor accreditation
 */
router.post(
  '/accreditation/verify',
  authenticateApiKey,
  verifyQuantumSignature,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      investorId,
      accreditationType,
      documentation,
      verificationType
    } = req.body;

    if (!investorId || !accreditationType || !verificationType) {
      return res.status(400).json({
        error: 'Missing required fields: investorId, accreditationType, verificationType'
      });
    }

    const status = await issuanceService.verifyAccreditation({
      investorId,
      accreditationType,
      documentation: documentation || [],
      verificationType
    });

    res.json({
      success: true,
      data: status
    });
  })
);

/**
 * GET /api/v1/issuance/accreditation/:investorId
 * Get accreditation status
 */
router.get(
  '/accreditation/:investorId',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { investorId } = req.params;

    const status = await issuanceService.getAccreditationStatus(investorId);

    if (!status) {
      return res.status(404).json({
        error: 'Investor accreditation not found'
      });
    }

    res.json({
      success: true,
      data: status
    });
  })
);

/**
 * POST /api/v1/issuance/token/mint
 * Mint security tokens
 */
router.post(
  '/token/mint',
  authenticateApiKey,
  verifyQuantumSignature,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const {
      offeringId,
      investorId,
      tokenAmount,
      vestingSchedule,
      lockupPeriod,
      walletAddress,
      purchasePrice,
      paymentMethod
    } = req.body;

    if (!offeringId || !investorId || !tokenAmount || !walletAddress || !purchasePrice) {
      return res.status(400).json({
        error: 'Missing required fields: offeringId, investorId, tokenAmount, walletAddress, purchasePrice'
      });
    }

    const holding = await issuanceService.mintTokens({
      offeringId,
      investorId,
      tokenAmount,
      vestingSchedule: vestingSchedule ? {
        ...vestingSchedule,
        startDate: new Date(vestingSchedule.startDate)
      } : undefined,
      lockupPeriod,
      walletAddress,
      purchasePrice,
      paymentMethod: paymentMethod || 'gxa',
      purchaseDate: new Date()
    });

    res.json({
      success: true,
      data: holding
    });
  })
);

/**
 * GET /api/v1/issuance/offering/:offeringId/cap-table
 * Get cap table
 */
router.get(
  '/offering/:offeringId/cap-table',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { offeringId } = req.params;

    const capTable = await issuanceService.getCapTable(offeringId);

    res.json({
      success: true,
      data: capTable
    });
  })
);

/**
 * POST /api/v1/issuance/filing/:filingType
 * Submit regulatory filing
 */
router.post(
  '/filing/:filingType',
  authenticateApiKey,
  verifyQuantumSignature,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { filingType } = req.params;
    const { offeringId, filingData, autoSubmit } = req.body;

    if (!offeringId || !filingData) {
      return res.status(400).json({
        error: 'Missing required fields: offeringId, filingData'
      });
    }

    if (!['form-d', 'form-c', 'form-1a'].includes(filingType)) {
      return res.status(400).json({
        error: 'Invalid filing type. Must be: form-d, form-c, or form-1a'
      });
    }

    const filing = await issuanceService.submitFiling({
      offeringId,
      filingType: filingType as any,
      filingData,
      autoSubmit
    });

    res.json({
      success: true,
      data: filing
    });
  })
);

/**
 * GET /api/v1/issuance/filing/:filingId
 * Get filing status
 */
router.get(
  '/filing/:filingId',
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { filingId } = req.params;

    // In production, implement getFilingStatus method
    res.status(501).json({
      error: 'Get filing status not yet implemented'
    });
  })
);

/**
 * POST /api/v1/issuance/transfer/check
 * Check transfer restrictions
 */
router.post(
  '/transfer/check',
  authenticateApiKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { offeringId, fromInvestorId, toInvestorId, tokenAmount } = req.body;

    if (!offeringId || !fromInvestorId || !toInvestorId || !tokenAmount) {
      return res.status(400).json({
        error: 'Missing required fields: offeringId, fromInvestorId, toInvestorId, tokenAmount'
      });
    }

    const result = await issuanceService.checkTransferRestrictions(
      offeringId,
      fromInvestorId,
      toInvestorId,
      tokenAmount
    );

    res.json({
      success: true,
      data: result
    });
  })
);

export default router;
