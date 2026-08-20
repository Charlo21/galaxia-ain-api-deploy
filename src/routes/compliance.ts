/**
 * Compliance API Routes
 * Endpoints for KYC, complaints, compliance status, and regulatory requirements
 */

import express, { Request, Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import {
  createOrUpdateKYCProfile,
  uploadKYCDocument,
  screenSanctions,
  screenPEP,
  getTransactionLimits,
  getKYCProfile,
  isKYCRequired,
  verifyKYCProfile
} from '../services/compliance/kycService';
import {
  createComplaint,
  getUserComplaints,
  getComplaint,
  acknowledgeComplaint,
  assignComplaint,
  resolveComplaint,
  escalateToRegulator,
  getOverdueComplaints
} from '../services/compliance/complaintsService';
import {
  detectJurisdiction,
  isGeoBlocked,
  getUserJurisdiction,
  updateDeclaredJurisdiction,
  getJurisdictionRequirements
} from '../services/compliance/jurisdictionService';
import {
  monitorTransaction,
  getUserAlerts
} from '../services/compliance/transactionMonitoring';
import {
  isTravelRuleRequired,
  createTravelRuleRecord,
  getTravelRuleRecord
} from '../services/compliance/travelRule';
import {
  getCurrentDocument,
  getRequiredDocuments,
  recordConsent,
  hasUserConsented
} from '../services/compliance/legalDocuments';
import { pool } from '../config/database';

const router = express.Router();

/**
 * GET /v1/compliance/status
 * Aggregate compliance posture for dashboards & ops.
 *
 * WHY: Regulators + internal ops need a single view across KYC tiers, geo-blocking,
 * sanctions/PEP screening, travel rule applicability, and audit logging posture.
 */
router.get('/status', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const profile = await getKYCProfile(userId);
    const jurisdiction = await getUserJurisdiction(userId).catch(() => null);

    // Basic geo-block check (using declared jurisdiction when present)
    const geoBlocked = jurisdiction ? await isGeoBlocked(jurisdiction.detected_country) : false;
    const requirements = jurisdiction ? await getJurisdictionRequirements(jurisdiction.detected_country) : null;

    // Travel rule applicability is transaction-dependent; expose policy + last record if present
    const travelRulePolicy = {
      supported: true,
      thresholdUsd: 1000,
      required: true,
    };

    res.json({
      ok: true,
      user: {
        userId,
        jurisdiction: jurisdiction?.detected_country || jurisdiction?.declared_country || null,
        geoBlocked,
      },
      kyc: profile
        ? {
            status: profile.kyc_status,
            level: profile.kyc_level,
            verificationTier: profile.verification_tier,
            verifiedAt: profile.verified_at,
            expiresAt: profile.expires_at,
            tiers: [
              { tier: 0, name: 'Unverified', limitUsd: 0, features: ['view-only'] },
              { tier: 1, name: 'Basic', limitUsd: 1000, features: ['staking', 'governance'] },
              { tier: 2, name: 'Enhanced', limitUsd: 10000, features: ['node-operation', 'inference'] },
              { tier: 3, name: 'Institutional', limitUsd: 100000, features: ['bulk-inference', 'priority-routing'] },
            ],
            currentTier: profile.verification_tier ?? 0,
          }
        : {
            status: 'none',
            level: 'none',
            verificationTier: 0,
            tiers: [
              { tier: 0, name: 'Unverified', limitUsd: 0, features: ['view-only'] },
              { tier: 1, name: 'Basic', limitUsd: 1000, features: ['staking', 'governance'] },
              { tier: 2, name: 'Enhanced', limitUsd: 10000, features: ['node-operation', 'inference'] },
              { tier: 3, name: 'Institutional', limitUsd: 100000, features: ['bulk-inference', 'priority-routing'] },
            ],
            currentTier: 0,
          },
      sanctions: {
        screened: Boolean(profile),
        pepScreened: Boolean(profile?.pep_status),
        status: profile?.sanctions_status || 'pending',
        lastScreenedAt: profile?.last_screened_at || null,
      },
      risk: {
        score: profile?.risk_score ?? null,
        level: profile?.risk_level || (profile?.risk_score != null
          ? profile.risk_score >= 70 ? 'high' : profile.risk_score >= 40 ? 'medium' : 'low'
          : 'unknown'),
        factors: profile?.risk_factors || [],
      },
      policy: {
        frameworks: [
          'MiCA/CASP/VASP',
          'Travel Rule (IVMS101)',
          'US (FinCEN/SEC/CFTC/IRS)',
          'UK (FCA)',
          'India (PMLA)',
          'South Korea (FSC/FIU)',
          'Vietnam (SBV)',
          'Brazil (BCB) / Argentina (CNV)',
        ],
        requirements,
        travelRule: travelRulePolicy,
      },
      logging: {
        auditLogging: true,
        retentionDays: 2555,
        immutableLedger: true,
      },
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ============================================================================
// KYC ENDPOINTS
// ============================================================================

/**
 * POST /v1/compliance/kyc/submit
 * Submit KYC information
 */
router.post('/kyc/submit', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      first_name,
      last_name,
      date_of_birth,
      nationality,
      country_of_residence,
      entity_name,
      entity_type
    } = req.body;

    const profile = await createOrUpdateKYCProfile(userId, {
      first_name,
      last_name,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : undefined,
      nationality,
      country_of_residence,
      entity_name,
      entity_type,
      kyc_level: 'basic',
      kyc_status: 'pending'
    });

    res.json({
      success: true,
      profile: {
        id: profile.id,
        kyc_level: profile.kyc_level,
        kyc_status: profile.kyc_status,
        verification_tier: profile.verification_tier
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/compliance/kyc/documents
 * Upload KYC document
 */
router.post('/kyc/documents', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    
    // Get KYC profile
    const profile = await getKYCProfile(userId);
    if (!profile) {
      return res.status(404).json({ error: 'KYC profile not found. Please submit KYC information first.' });
    }

    const {
      document_type,
      document_number,
      issuing_country,
      issue_date,
      expiry_date
    } = req.body;

    // In production, handle file upload (multipart/form-data)
    // For now, accept file data in request
    const fileData = req.body.file_data ? Buffer.from(req.body.file_data, 'base64') : Buffer.alloc(0);

    const documentId = await uploadKYCDocument(profile.id, {
      document_type,
      document_number,
      issuing_country,
      issue_date: issue_date ? new Date(issue_date) : undefined,
      expiry_date: expiry_date ? new Date(expiry_date) : undefined
    }, fileData);

    res.json({
      success: true,
      document_id: documentId
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/compliance/kyc/screen
 * Run sanctions and PEP screening
 */
router.post('/kyc/screen', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profile = await getKYCProfile(userId);
    
    if (!profile) {
      return res.status(404).json({ error: 'KYC profile not found' });
    }

    const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
    
    // Run sanctions screening
    const sanctionsResult = await screenSanctions(
      userId,
      fullName,
      profile.date_of_birth,
      profile.nationality
    );

    // Run PEP screening
    const pepResult = await screenPEP(
      userId,
      fullName,
      profile.date_of_birth,
      profile.nationality
    );

    res.json({
      success: true,
      sanctions: {
        match_found: sanctionsResult.match_found,
        match_score: sanctionsResult.match_score
      },
      pep: {
        is_pep: pepResult.isPEP,
        pep_status: pepResult.pepStatus
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/compliance/kyc/status
 * Get KYC status and limits
 */
router.get('/kyc/status', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profile = await getKYCProfile(userId);
    
    if (!profile) {
      return res.json({
        kyc_status: 'none',
        kyc_level: 'none',
        verification_tier: 0,
        limits: {
          daily: 0,
          monthly: 0,
          annual: 0,
          single: 0
        }
      });
    }

    const limits = await getTransactionLimits(userId);

    res.json({
      kyc_status: profile.kyc_status,
      kyc_level: profile.kyc_level,
      verification_tier: profile.verification_tier,
      limits,
      verified_at: profile.verified_at,
      expires_at: profile.expires_at
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/compliance/kyc/required
 * Check if KYC is required for transaction amount
 */
router.get('/kyc/required', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const amount = parseFloat(req.query.amount as string);

    if (isNaN(amount)) {
      return res.status(400).json({ error: 'Invalid amount parameter' });
    }

    const required = await isKYCRequired(userId, amount);
    const limits = await getTransactionLimits(userId);

    res.json({
      kyc_required: required,
      current_limits: limits,
      transaction_amount: amount,
      exceeds_limit: amount > limits.single
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// COMPLAINTS ENDPOINTS
// ============================================================================

/**
 * POST /v1/compliance/complaints
 * Submit a complaint
 */
router.post('/complaints', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      category,
      subject,
      description,
      related_transaction_id,
      related_task_id
    } = req.body;

    if (!category || !subject || !description) {
      return res.status(400).json({ error: 'Category, subject, and description are required' });
    }

    const complaint = await createComplaint(userId, {
      category,
      subject,
      description,
      related_transaction_id,
      related_task_id
    });

    res.status(201).json({
      success: true,
      complaint: {
        id: complaint.id,
        complaint_number: complaint.complaint_number,
        status: complaint.status,
        response_due_date: complaint.response_due_date
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/compliance/complaints
 * Get user's complaints
 */
router.get('/complaints', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const status = req.query.status as string | undefined;

    const complaints = await getUserComplaints(userId, status);

    res.json({
      complaints: complaints.map(c => ({
        id: c.id,
        complaint_number: c.complaint_number,
        category: c.category,
        subject: c.subject,
        status: c.status,
        submitted_at: c.submitted_at,
        response_due_date: c.response_due_date,
        resolved_at: c.resolved_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/compliance/complaints/:id
 * Get specific complaint
 */
router.get('/complaints/:id', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const complaintId = req.params.id;

    const complaint = await getComplaint(complaintId);

    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Verify user owns this complaint
    if (complaint.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ complaint });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// JURISDICTION ENDPOINTS
// ============================================================================

/**
 * GET /v1/compliance/jurisdiction
 * Get user jurisdiction information
 */
router.get('/jurisdiction', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || '';

    // Detect or get jurisdiction
    let jurisdiction = await getUserJurisdiction(userId);
    
    if (!jurisdiction && ipAddress) {
      jurisdiction = await detectJurisdiction(userId, ipAddress);
    }

    if (!jurisdiction) {
      return res.status(404).json({ error: 'Jurisdiction not detected' });
    }

    const requirements = await getJurisdictionRequirements(jurisdiction.detected_country);

    res.json({
      jurisdiction: {
        detected_country: jurisdiction.detected_country,
        detected_region: jurisdiction.detected_region,
        declared_country: jurisdiction.declared_country,
        jurisdiction_status: jurisdiction.jurisdiction_status,
        geo_blocked: jurisdiction.geo_blocked,
        license_required: jurisdiction.license_required,
        license_held: jurisdiction.license_held
      },
      requirements
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/compliance/jurisdiction/declare
 * Declare jurisdiction (self-declared)
 */
router.post('/jurisdiction/declare', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { country, region } = req.body;

    if (!country) {
      return res.status(400).json({ error: 'Country is required' });
    }

    await updateDeclaredJurisdiction(userId, country, region);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TRANSACTION MONITORING ENDPOINTS
// ============================================================================

/**
 * GET /v1/compliance/alerts
 * Get transaction alerts for user
 */
router.get('/alerts', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const status = req.query.status as string | undefined;

    const alerts = await getUserAlerts(userId, status);

    res.json({
      alerts: alerts.map(a => ({
        id: a.id,
        alert_type: a.alert_type,
        severity: a.severity,
        status: a.status,
        rule_triggered: a.rule_triggered,
        detection_score: a.detection_score,
        created_at: a.created_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TRAVEL RULE ENDPOINTS
// ============================================================================

/**
 * GET /v1/compliance/travel-rule/required
 * Check if Travel Rule applies to transaction
 */
router.get('/travel-rule/required', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const amount = parseFloat(req.query.amount as string);

    if (isNaN(amount)) {
      return res.status(400).json({ error: 'Invalid amount parameter' });
    }

    const check = await isTravelRuleRequired(amount, userId);

    res.json({
      required: check.required,
      threshold: check.threshold,
      jurisdiction: check.jurisdiction,
      amount,
      exceeds_threshold: amount >= check.threshold
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/compliance/travel-rule/:transactionId
 * Get Travel Rule record for transaction
 */
router.get('/travel-rule/:transactionId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const transactionId = req.params.transactionId;
    const record = await getTravelRuleRecord(transactionId);

    if (!record) {
      return res.status(404).json({ error: 'Travel Rule record not found' });
    }

    res.json({ travel_rule_record: record });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ADMIN ENDPOINTS (Require admin authentication)
// ============================================================================

/**
 * GET /v1/compliance/admin/overdue-complaints
 * Get overdue complaints (admin only)
 */
import { requireAdmin } from '../middleware/adminAuth';
router.get('/admin/overdue-complaints', authenticateApiKey, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const complaints = await getOverdueComplaints();

    res.json({ complaints });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/compliance/admin/kyc/verify
 * Verify KYC profile (admin only)
 */
router.post('/admin/kyc/verify', authenticateApiKey, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { kyc_profile_id, tier } = req.body;
    const verifiedBy = req.userId!;

    if (!kyc_profile_id || !tier) {
      return res.status(400).json({ error: 'kyc_profile_id and tier are required' });
    }

    await verifyKYCProfile(kyc_profile_id, verifiedBy, tier);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LEGAL DOCUMENTS ENDPOINTS
// ============================================================================

/**
 * GET /v1/compliance/legal-documents
 * Get all required legal documents for user
 */
router.get('/legal-documents', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const jurisdiction = req.query.jurisdiction as string | undefined;

    const documents = await getRequiredDocuments(userId, jurisdiction);

    res.json({
      documents: documents.map(doc => ({
        id: doc.id,
        document_type: doc.document_type,
        version: doc.version,
        title: doc.title,
        summary: doc.summary,
        effective_date: doc.effective_date,
        mandatory: doc.mandatory,
        consented: doc.consented
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/compliance/legal-documents/:type
 * Get specific legal document
 */
router.get('/legal-documents/:type', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const documentType = req.params.type;
    const jurisdiction = req.query.jurisdiction as string | undefined;

    const document = await getCurrentDocument(documentType, jurisdiction);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({
      document: {
        id: document.id,
        document_type: document.document_type,
        version: document.version,
        title: document.title,
        content: document.content,
        summary: document.summary,
        effective_date: document.effective_date
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/compliance/legal-documents/:documentId/consent
 * Record user consent to legal document
 */
router.post('/legal-documents/:documentId/consent', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const documentId = req.params.documentId;
    const { consented, document_version } = req.body;

    if (typeof consented !== 'boolean') {
      return res.status(400).json({ error: 'consented must be a boolean' });
    }

    if (!document_version) {
      return res.status(400).json({ error: 'document_version is required' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'] as string || '';
    const userAgent = req.headers['user-agent'] || '';

    await recordConsent(
      userId,
      documentId,
      document_version,
      consented,
      ipAddress,
      userAgent
    );

    res.json({ success: true, consented });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

