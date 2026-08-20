/**
 * Galaxia Issuance Service
 * Core service for SEC-compliant securities token issuance
 */

import { pool } from '../../config/database';
import { logger } from '../../index';
import { v4 as uuidv4 } from 'uuid';
import {
  OfferingRequest,
  Offering,
  AccreditationRequest,
  AccreditationStatus,
  TokenMintRequest,
  TokenHolding,
  CapTable,
  FilingRequest,
  FilingStatus
} from '../galaxia/integrations/issuanceClient';
import { auditService } from '../audit/auditService';

export class IssuanceService {
  /**
   * Create a new securities offering
   */
  async createOffering(request: OfferingRequest): Promise<Offering> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify audit certification
      const certVerification = await auditService.verifyCertification(request.auditCertificationId);
      if (!certVerification.valid || !certVerification.certified) {
        throw new Error('Invalid or uncertified audit. Security tokens require a valid audit certification.');
      }

      const offeringId = uuidv4();
      const status = 'ready_for_issuance'; // Will be set to pending_audit if audit fails

      await client.query(
        `INSERT INTO offerings (
          offering_id, offering_type, security_type, issuer_id, issuer_details,
          audit_certification_id, offering_amount, token_name, token_symbol,
          total_supply, decimals, transfer_restrictions, status, compliance_status,
          compliance_documents, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          offeringId,
          request.offeringType,
          request.securityType,
          uuidv4(), // issuer_id - in production, get from authenticated user
          JSON.stringify(request.issuerDetails),
          request.auditCertificationId,
          request.offeringAmount,
          request.tokenDetails.name,
          request.tokenDetails.symbol,
          request.tokenDetails.totalSupply,
          request.tokenDetails.decimals || 18,
          JSON.stringify(request.tokenDetails.transferRestrictions),
          status,
          JSON.stringify({
            kyc: 'pending',
            aml: 'pending'
          }),
          JSON.stringify(request.complianceDocuments || []),
          JSON.stringify(request.metadata || {})
        ]
      );

      await client.query('COMMIT');

      // Emit event
      this.emitOfferingCreated(offeringId, request);

      const offering = await this.getOffering(offeringId);
      return offering!;
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Create offering failed', { error: error.message, request });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get offering details
   */
  async getOffering(offeringId: string): Promise<Offering | null> {
    try {
      const result = await pool.query(
        `SELECT * FROM offerings WHERE offering_id = $1`,
        [offeringId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        offeringId: row.offering_id,
        offeringType: row.offering_type,
        securityType: row.security_type,
        issuerId: row.issuer_id,
        auditCertificationId: row.audit_certification_id,
        offeringAmount: parseFloat(row.offering_amount),
        tokenContractAddress: row.token_contract_address,
        status: row.status,
        complianceStatus: row.compliance_status,
        createdAt: row.created_at,
        activatedAt: row.activated_at ? new Date(row.activated_at) : undefined,
        closedAt: row.closed_at ? new Date(row.closed_at) : undefined
      };
    } catch (error: any) {
      logger.error('Get offering failed', { offeringId, error: error.message });
      throw error;
    }
  }

  /**
   * Verify investor accreditation
   */
  async verifyAccreditation(request: AccreditationRequest): Promise<AccreditationStatus> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if investor exists
      let investorResult = await pool.query(
        `SELECT * FROM investors WHERE galaxia_id_user_id = $1`,
        [request.investorId]
      );

      let investorId: string;
      if (investorResult.rows.length === 0) {
        // Create new investor record
        investorId = uuidv4();
        await client.query(
          `INSERT INTO investors (
            investor_id, galaxia_id_user_id, accreditation_status,
            accreditation_type, verification_method, jurisdiction
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            investorId,
            request.investorId,
            'pending',
            request.accreditationType,
            request.verificationType,
            'US' // Default, should come from request
          ]
        );
      } else {
        investorId = investorResult.rows[0].investor_id;
      }

      // Perform accreditation verification
      // In production, this would integrate with third-party verification services
      const accredited = request.verificationType === 'automatic' || 
                       request.verificationType === 'third-party';

      const verifiedAt = new Date();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 year validity

      await client.query(
        `UPDATE investors 
         SET accreditation_status = $1,
             accreditation_verified_at = $2,
             accreditation_expires_at = $3,
             verification_method = $4
         WHERE investor_id = $5`,
        [
          accredited ? 'accredited' : 'non-accredited',
          verifiedAt,
          expiresAt,
          request.verificationType,
          investorId
        ]
      );

      await client.query('COMMIT');

      return {
        investorId: request.investorId,
        accredited,
        accreditationType: request.accreditationType,
        verifiedAt,
        expiresAt,
        verificationMethod: request.verificationType,
        jurisdiction: 'US',
        restrictions: accredited ? [] : ['accredited-only-offerings']
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Verify accreditation failed', { error: error.message, request });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get accreditation status
   */
  async getAccreditationStatus(investorId: string): Promise<AccreditationStatus | null> {
    try {
      const result = await pool.query(
        `SELECT * FROM investors WHERE galaxia_id_user_id = $1`,
        [investorId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        investorId,
        accredited: row.accreditation_status === 'accredited',
        accreditationType: row.accreditation_type,
        verifiedAt: row.accreditation_verified_at ? new Date(row.accreditation_verified_at) : undefined,
        expiresAt: row.accreditation_expires_at ? new Date(row.accreditation_expires_at) : undefined,
        verificationMethod: row.verification_method,
        jurisdiction: row.jurisdiction,
        restrictions: row.restrictions || []
      };
    } catch (error: any) {
      logger.error('Get accreditation status failed', { investorId, error: error.message });
      throw error;
    }
  }

  /**
   * Mint security tokens
   */
  async mintTokens(request: TokenMintRequest): Promise<TokenHolding> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify offering exists and is active
      const offering = await this.getOffering(request.offeringId);
      if (!offering || offering.status !== 'active') {
        throw new Error('Offering not found or not active');
      }

      // Verify investor accreditation if required
      const accreditation = await this.getAccreditationStatus(request.investorId);
      const offeringResult = await pool.query(
        `SELECT transfer_restrictions FROM offerings WHERE offering_id = $1`,
        [request.offeringId]
      );
      const restrictions = offeringResult.rows[0]?.transfer_restrictions || {};
      
      if (restrictions.accreditedOnly && (!accreditation || !accreditation.accredited)) {
        throw new Error('Investor must be accredited for this offering');
      }

      // Get or create investor record
      let investorResult = await pool.query(
        `SELECT investor_id FROM investors WHERE galaxia_id_user_id = $1`,
        [request.investorId]
      );

      let investorId: string;
      if (investorResult.rows.length === 0) {
        investorId = uuidv4();
        await client.query(
          `INSERT INTO investors (investor_id, galaxia_id_user_id, jurisdiction)
           VALUES ($1, $2, $3)`,
          [investorId, request.investorId, 'US']
        );
      } else {
        investorId = investorResult.rows[0].investor_id;
      }

      // Calculate lockup end date
      let lockupEndDate: Date | undefined;
      if (request.lockupPeriod) {
        lockupEndDate = new Date();
        // Parse ISO-8601 duration (simplified)
        const match = request.lockupPeriod.match(/P(\d+)M/);
        if (match) {
          lockupEndDate.setMonth(lockupEndDate.getMonth() + parseInt(match[1]));
        }
      }

      // Create token holding
      const holdingId = uuidv4();
      await client.query(
        `INSERT INTO token_holdings (
          holding_id, offering_id, investor_id, token_amount, purchase_price,
          purchase_date, vesting_schedule, lockup_end_date, transfer_restrictions, wallet_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          holdingId,
          request.offeringId,
          investorId,
          request.tokenAmount,
          request.purchasePrice,
          request.purchaseDate || new Date(),
          request.vestingSchedule ? JSON.stringify({
            ...request.vestingSchedule,
            startDate: request.vestingSchedule.startDate.toISOString(),
            vestedAmount: 0,
            unvestedAmount: request.tokenAmount
          }) : null,
          lockupEndDate,
          JSON.stringify(restrictions),
          request.walletAddress
        ]
      );

      await client.query('COMMIT');

      // Emit event
      this.emitTokenIssued(request.offeringId, request.investorId, request.tokenAmount);

      const holding = await this.getTokenHolding(holdingId);
      if (!holding) {
        throw new Error('Token holding not found after mint');
      }
      return holding;
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Mint tokens failed', { error: error.message, request });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get token holding
   */
  async getTokenHolding(holdingId: string): Promise<TokenHolding | null> {
    try {
      const result = await pool.query(
        `SELECT * FROM token_holdings WHERE holding_id = $1`,
        [holdingId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        holdingId: row.holding_id,
        offeringId: row.offering_id,
        investorId: row.investor_id,
        tokenAmount: parseFloat(row.token_amount),
        purchasePrice: parseFloat(row.purchase_price),
        purchaseDate: row.purchase_date,
        vestingSchedule: row.vesting_schedule,
        lockupEndDate: row.lockup_end_date ? new Date(row.lockup_end_date) : undefined,
        transferRestrictions: row.transfer_restrictions
      };
    } catch (error: any) {
      logger.error('Get token holding failed', { holdingId, error: error.message });
      throw error;
    }
  }

  /**
   * Get cap table
   */
  async getCapTable(offeringId: string): Promise<CapTable> {
    try {
      const result = await pool.query(
        `SELECT 
          th.investor_id, th.token_amount, th.purchase_date, th.vesting_schedule,
          th.transfer_restrictions,
          SUM(th.token_amount) OVER () as total_shares,
          COUNT(DISTINCT th.investor_id) OVER () as total_holders
        FROM token_holdings th
        WHERE th.offering_id = $1`,
        [offeringId]
      );

      if (result.rows.length === 0) {
        const offeringResult = await pool.query(
          `SELECT total_supply FROM offerings WHERE offering_id = $1`,
          [offeringId]
        );
        const totalSupply = offeringResult.rows[0]?.total_supply || 0;

        return {
          totalShares: parseFloat(totalSupply),
          totalHolders: 0,
          holders: []
        };
      }

      const totalShares = parseFloat(result.rows[0].total_shares);
      const totalHolders = parseInt(result.rows[0].total_holders);

      const holders = result.rows.map(row => {
        const shares = parseFloat(row.token_amount);
        const percentage = (shares / totalShares) * 100;

        return {
          investorId: row.investor_id,
          shares,
          percentage,
          vestingStatus: row.vesting_schedule ? {
            vested: row.vesting_schedule.vestedAmount || 0,
            unvested: row.vesting_schedule.unvestedAmount || shares,
            nextVestDate: row.vesting_schedule.nextVestDate ? new Date(row.vesting_schedule.nextVestDate) : undefined
          } : undefined,
          restrictions: row.transfer_restrictions?.restrictions || [],
          purchaseDate: row.purchase_date
        };
      });

      return {
        totalShares,
        totalHolders,
        holders
      };
    } catch (error: any) {
      logger.error('Get cap table failed', { offeringId, error: error.message });
      throw error;
    }
  }

  /**
   * Submit regulatory filing
   */
  async submitFiling(request: FilingRequest): Promise<FilingStatus> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const filingId = uuidv4();
      const status = request.autoSubmit ? 'submitted' : 'draft';

      await client.query(
        `INSERT INTO regulatory_filings (
          filing_id, offering_id, filing_type, filing_data, status, auto_submitted, submitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          filingId,
          request.offeringId,
          request.filingType,
          JSON.stringify(request.filingData),
          status,
          request.autoSubmit || false,
          request.autoSubmit ? new Date() : null
        ]
      );

      await client.query('COMMIT');

      return {
        filingId,
        offeringId: request.offeringId,
        filingType: request.filingType,
        status,
        submittedAt: request.autoSubmit ? new Date() : undefined
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Submit filing failed', { error: error.message, request });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check transfer restrictions
   */
  async checkTransferRestrictions(
    offeringId: string,
    fromInvestorId: string,
    toInvestorId: string,
    tokenAmount: number
  ): Promise<{ allowed: boolean; restrictions: string[]; reason?: string }> {
    try {
      // Get offering restrictions
      const offeringResult = await pool.query(
        `SELECT transfer_restrictions FROM offerings WHERE offering_id = $1`,
        [offeringId]
      );

      if (offeringResult.rows.length === 0) {
        return { allowed: false, restrictions: ['offering-not-found'] };
      }

      const restrictions = offeringResult.rows[0].transfer_restrictions || {};
      const appliedRestrictions: string[] = [];

      // Check lockup period
      const holdingResult = await pool.query(
        `SELECT lockup_end_date FROM token_holdings 
         WHERE offering_id = $1 AND investor_id = $2
         LIMIT 1`,
        [offeringId, fromInvestorId]
      );

      if (holdingResult.rows.length > 0) {
        const lockupEndDate = holdingResult.rows[0].lockup_end_date;
        if (lockupEndDate && new Date(lockupEndDate) > new Date()) {
          appliedRestrictions.push('lockup-period-active');
        }
      }

      // Check accredited investor requirement
      if (restrictions.accreditedOnly) {
        const toAccreditation = await this.getAccreditationStatus(toInvestorId);
        if (!toAccreditation || !toAccreditation.accredited) {
          appliedRestrictions.push('recipient-must-be-accredited');
        }
      }

      // Check jurisdiction restrictions
      if (restrictions.jurisdictionRestrictions && restrictions.jurisdictionRestrictions.length > 0) {
        const toAccreditation = await this.getAccreditationStatus(toInvestorId);
        if (toAccreditation && restrictions.jurisdictionRestrictions.includes(toAccreditation.jurisdiction)) {
          appliedRestrictions.push('jurisdiction-restricted');
        }
      }

      // Log the check
      await pool.query(
        `INSERT INTO transfer_restrictions_log (
          log_id, offering_id, from_investor_id, to_investor_id,
          token_amount, allowed, restrictions_applied
        ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6)`,
        [
          offeringId,
          fromInvestorId,
          toInvestorId,
          tokenAmount,
          appliedRestrictions.length === 0,
          appliedRestrictions
        ]
      );

      return {
        allowed: appliedRestrictions.length === 0,
        restrictions: appliedRestrictions,
        reason: appliedRestrictions.length > 0 ? appliedRestrictions.join(', ') : undefined
      };
    } catch (error: any) {
      logger.error('Check transfer restrictions failed', { offeringId, error: error.message });
      throw error;
    }
  }

  /**
   * Emit offering created event
   */
  private emitOfferingCreated(offeringId: string, request: OfferingRequest): void {
    logger.info('Offering created event', { offeringId, offeringType: request.offeringType });
    
    // Import event bus dynamically to avoid circular dependencies
    import('../events/auditEventHandler').then(({ AuditEventBus }) => {
      AuditEventBus.publishOfferingCreated({
        offeringId,
        offeringType: request.offeringType,
        contractCode: request.metadata?.contractCode,
        contractAddress: request.metadata?.contractAddress
      }).catch(err => logger.error('Failed to publish offering.created event', { error: err.message }));
    });
  }

  /**
   * Emit token issued event
   */
  private emitTokenIssued(offeringId: string, investorId: string, tokenAmount: number): void {
    logger.info('Token issued event', { offeringId, investorId, tokenAmount });
    
    // Import event bus dynamically to avoid circular dependencies
    import('../events/auditEventHandler').then(({ AuditEventBus }) => {
      AuditEventBus.publishTokenIssued({
        offeringId,
        investorId,
        tokenAmount,
        walletAddress: '' // Should be passed from request
      }).catch(err => logger.error('Failed to publish token.issued event', { error: err.message }));
    });
  }
}

export const issuanceService = new IssuanceService();
