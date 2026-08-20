/**
 * Galaxia Issuance Client
 * SEC-compliant securities token issuance platform integration
 */

import { getGalaxiaEcosystem } from '../ecosystem';
import { quantumSecurityService } from '../quantumSecurity';
import { logger } from '../../../index';

export type OfferingType = 'reg-d' | 'reg-a' | 'reg-s' | 'reg-cf';
export type SecurityType = 'equity' | 'debt' | 'hybrid' | 'derivative';
export type AccreditationType = 'income' | 'net-worth' | 'entity' | 'sophisticated';
export type VerificationType = 'self-certified' | 'third-party' | 'automatic';

export interface OfferingRequest {
  offeringType: OfferingType;
  securityType: SecurityType;
  issuerDetails: {
    name: string;
    entityType: string;
    jurisdiction: string;
    taxId?: string;
    legalAddress: string;
  };
  offeringAmount: number;
  tokenDetails: {
    name: string;
    symbol: string;
    totalSupply: number;
    decimals?: number;
    transferRestrictions: {
      lockupPeriod?: string; // ISO-8601 duration
      accreditedOnly?: boolean;
      jurisdictionRestrictions?: string[];
      maxHolders?: number;
    };
  };
  auditCertificationId: string; // Required from Galaxia Audit
  complianceDocuments?: Array<{
    type: string;
    url: string;
    hash: string;
  }>;
  metadata?: Record<string, any>;
}

export interface Offering {
  offeringId: string;
  offeringType: OfferingType;
  securityType: SecurityType;
  issuerId: string;
  auditCertificationId: string;
  offeringAmount: number;
  tokenContractAddress?: string;
  status: 'draft' | 'pending_audit' | 'ready_for_issuance' | 'active' | 'closed' | 'cancelled';
  complianceStatus: {
    kyc: 'pending' | 'approved' | 'rejected';
    aml: 'pending' | 'approved' | 'rejected';
    secFiling?: 'pending' | 'submitted' | 'approved' | 'rejected';
    blueSky?: Record<string, 'pending' | 'approved' | 'rejected'>;
  };
  createdAt: Date;
  activatedAt?: Date;
  closedAt?: Date;
}

export interface AccreditationRequest {
  investorId: string; // from Galaxia ID
  accreditationType: AccreditationType;
  documentation: Array<{
    type: string;
    url: string;
    hash: string;
  }>;
  verificationType: VerificationType;
  metadata?: Record<string, any>;
}

export interface AccreditationStatus {
  investorId: string;
  accredited: boolean;
  accreditationType?: AccreditationType;
  verifiedAt?: Date;
  expiresAt?: Date;
  verificationMethod: VerificationType;
  jurisdiction: string;
  restrictions?: string[];
}

export interface TokenMintRequest {
  offeringId: string;
  investorId: string;
  tokenAmount: number;
  vestingSchedule?: {
    startDate: Date;
    cliffPeriod?: string; // ISO-8601 duration
    vestingPeriod: string; // ISO-8601 duration
    intervals?: number;
  };
  lockupPeriod?: string; // ISO-8601 duration
  walletAddress: string; // from Galaxia Wallet
  purchasePrice: number;
  purchaseDate?: Date;
  paymentMethod: 'gxa' | 'usdc' | 'wire';
}

export interface TokenHolding {
  holdingId: string;
  offeringId: string;
  investorId: string;
  tokenAmount: number;
  purchasePrice: number;
  purchaseDate: Date;
  vestingSchedule?: {
    startDate: Date;
    cliffPeriod?: string;
    vestingPeriod: string;
    intervals: number;
    vestedAmount: number;
    unvestedAmount: number;
    nextVestDate?: Date;
  };
  lockupEndDate?: Date;
  transferRestrictions: {
    canTransfer: boolean;
    restrictions: string[];
  };
}

export interface CapTable {
  totalShares: number;
  totalHolders: number;
  holders: Array<{
    investorId: string;
    shares: number;
    percentage: number;
    vestingStatus?: {
      vested: number;
      unvested: number;
      nextVestDate?: Date;
    };
    restrictions: string[];
    purchaseDate: Date;
  }>;
}

export interface FilingRequest {
  offeringId: string;
  filingType: 'form-d' | 'form-c' | 'form-1a';
  filingData: Record<string, any>;
  autoSubmit?: boolean;
}

export interface FilingStatus {
  filingId: string;
  offeringId: string;
  filingType: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'amended';
  confirmationNumber?: string;
  submittedAt?: Date;
  secResponse?: Record<string, any>;
}

export class GalaxiaIssuanceClient {
  private baseUrl: string;
  private quantumEnabled: boolean;
  private ecosystemService = getGalaxiaEcosystem();

  constructor(config: {
    quantum?: boolean;
    baseUrl?: string;
  } = {}) {
    this.baseUrl = config.baseUrl || process.env.GALAXIA_ISSUANCE_URL || 'https://issuance.galaxia.io';
    this.quantumEnabled = config.quantum !== false;
  }

  /**
   * Create a new securities offering
   */
  async createOffering(request: OfferingRequest): Promise<Offering> {
    try {
      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'Content-Type': 'application/json'
      };

      if (this.quantumEnabled) {
        const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
        Object.assign(headers, quantumHeaders);
      }

      const response = await this.ecosystemService.request<{
        success: boolean;
        data: Offering;
      }>('POST', `${this.baseUrl}/api/v1/issuance/offering`, request, { headers });

      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt),
        activatedAt: response.data.activatedAt ? new Date(response.data.activatedAt) : undefined,
        closedAt: response.data.closedAt ? new Date(response.data.closedAt) : undefined
      };
    } catch (error: any) {
      logger.error('Create offering failed', {
        error: error.message,
        offeringType: request.offeringType
      });
      throw new Error(`Create offering failed: ${error.message}`);
    }
  }

  /**
   * Get offering details
   */
  async getOffering(offeringId: string): Promise<Offering> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: Offering;
      }>('GET', `${this.baseUrl}/api/v1/issuance/offering/${offeringId}`);

      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt),
        activatedAt: response.data.activatedAt ? new Date(response.data.activatedAt) : undefined,
        closedAt: response.data.closedAt ? new Date(response.data.closedAt) : undefined
      };
    } catch (error: any) {
      logger.error('Get offering failed', { offeringId, error: error.message });
      throw new Error(`Get offering failed: ${error.message}`);
    }
  }

  /**
   * Verify investor accreditation
   */
  async verifyAccreditation(request: AccreditationRequest): Promise<AccreditationStatus> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: AccreditationStatus;
      }>('POST', `${this.baseUrl}/api/v1/issuance/accreditation/verify`, request);

      return {
        ...response.data,
        verifiedAt: response.data.verifiedAt ? new Date(response.data.verifiedAt) : undefined,
        expiresAt: response.data.expiresAt ? new Date(response.data.expiresAt) : undefined
      };
    } catch (error: any) {
      logger.error('Verify accreditation failed', {
        investorId: request.investorId,
        error: error.message
      });
      throw new Error(`Verify accreditation failed: ${error.message}`);
    }
  }

  /**
   * Get accreditation status
   */
  async getAccreditationStatus(investorId: string): Promise<AccreditationStatus | null> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: AccreditationStatus | null;
      }>('GET', `${this.baseUrl}/api/v1/issuance/accreditation/${investorId}`);

      if (!response.data) return null;

      return {
        ...response.data,
        verifiedAt: response.data.verifiedAt ? new Date(response.data.verifiedAt) : undefined,
        expiresAt: response.data.expiresAt ? new Date(response.data.expiresAt) : undefined
      };
    } catch (error: any) {
      logger.error('Get accreditation status failed', { investorId, error: error.message });
      throw new Error(`Get accreditation status failed: ${error.message}`);
    }
  }

  /**
   * Mint security tokens for an investor
   */
  async mintTokens(request: TokenMintRequest): Promise<TokenHolding> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: TokenHolding;
      }>('POST', `${this.baseUrl}/api/v1/issuance/token/mint`, {
        ...request,
        vestingSchedule: request.vestingSchedule ? {
          ...request.vestingSchedule,
          startDate: request.vestingSchedule.startDate.toISOString()
        } : undefined
      });

      return {
        ...response.data,
        purchaseDate: new Date(response.data.purchaseDate),
        vestingSchedule: response.data.vestingSchedule ? {
          ...response.data.vestingSchedule,
          startDate: new Date(response.data.vestingSchedule.startDate),
          nextVestDate: response.data.vestingSchedule.nextVestDate
            ? new Date(response.data.vestingSchedule.nextVestDate)
            : undefined
        } : undefined,
        lockupEndDate: response.data.lockupEndDate ? new Date(response.data.lockupEndDate) : undefined
      };
    } catch (error: any) {
      logger.error('Mint tokens failed', {
        offeringId: request.offeringId,
        investorId: request.investorId,
        error: error.message
      });
      throw new Error(`Mint tokens failed: ${error.message}`);
    }
  }

  /**
   * Get cap table for an offering
   */
  async getCapTable(offeringId: string): Promise<CapTable> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: CapTable;
      }>('GET', `${this.baseUrl}/api/v1/issuance/offering/${offeringId}/cap-table`);

      return {
        ...response.data,
        holders: response.data.holders.map(holder => ({
          ...holder,
          purchaseDate: new Date(holder.purchaseDate),
          vestingStatus: holder.vestingStatus ? {
            ...holder.vestingStatus,
            nextVestDate: holder.vestingStatus.nextVestDate
              ? new Date(holder.vestingStatus.nextVestDate)
              : undefined
          } : undefined
        }))
      };
    } catch (error: any) {
      logger.error('Get cap table failed', { offeringId, error: error.message });
      throw new Error(`Get cap table failed: ${error.message}`);
    }
  }

  /**
   * Submit regulatory filing
   */
  async submitFiling(request: FilingRequest): Promise<FilingStatus> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: FilingStatus;
      }>('POST', `${this.baseUrl}/api/v1/issuance/filing/${request.filingType}`, request);

      return {
        ...response.data,
        submittedAt: response.data.submittedAt ? new Date(response.data.submittedAt) : undefined
      };
    } catch (error: any) {
      logger.error('Submit filing failed', {
        offeringId: request.offeringId,
        filingType: request.filingType,
        error: error.message
      });
      throw new Error(`Submit filing failed: ${error.message}`);
    }
  }

  /**
   * Get filing status
   */
  async getFilingStatus(filingId: string): Promise<FilingStatus> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: FilingStatus;
      }>('GET', `${this.baseUrl}/api/v1/issuance/filing/${filingId}`);

      return {
        ...response.data,
        submittedAt: response.data.submittedAt ? new Date(response.data.submittedAt) : undefined
      };
    } catch (error: any) {
      logger.error('Get filing status failed', { filingId, error: error.message });
      throw new Error(`Get filing status failed: ${error.message}`);
    }
  }

  /**
   * Check if transfer is allowed
   */
  async checkTransferRestrictions(
    offeringId: string,
    fromInvestorId: string,
    toInvestorId: string,
    tokenAmount: number
  ): Promise<{
    allowed: boolean;
    restrictions: string[];
    reason?: string;
  }> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: {
          allowed: boolean;
          restrictions: string[];
          reason?: string;
        };
      }>('POST', `${this.baseUrl}/api/v1/issuance/transfer/check`, {
        offeringId,
        fromInvestorId,
        toInvestorId,
        tokenAmount
      });

      return response.data;
    } catch (error: any) {
      logger.error('Check transfer restrictions failed', {
        offeringId,
        error: error.message
      });
      throw new Error(`Check transfer restrictions failed: ${error.message}`);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.ecosystemService.request<{ success: boolean }>(
        'GET',
        `${this.baseUrl}/health`
      );
      return response.success !== false;
    } catch {
      return false;
    }
  }
}
