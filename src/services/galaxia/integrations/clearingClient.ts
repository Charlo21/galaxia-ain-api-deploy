/**
 * Galaxia Clearing Client
 * Settlement and clearing house services for cross-application transactions
 */

import { ecosystemService } from '../ecosystem';
import { quantumSecurityService } from '../quantumSecurity';
import { logger } from '../../../index';

export interface ClearingTransaction {
  id?: string;
  originatorId: string;
  beneficiaryId: string;
  amount: number;
  currency: string;
  transactionType: 'payment' | 'settlement' | 'netting' | 'refund';
  metadata?: Record<string, any>;
  complianceData?: {
    kycLevel?: string;
    jurisdiction?: string;
    travelRule?: boolean;
  };
}

export interface ClearingResult {
  id: string;
  status: 'pending' | 'cleared' | 'settled' | 'failed' | 'disputed';
  netAmount?: number;
  settlementDate?: Date;
  transactionHash?: string; // Constellation L1 transaction hash
  complianceStatus?: 'approved' | 'pending' | 'rejected';
  error?: string;
}

export interface NettingResult {
  netAmount: number;
  participantCount: number;
  transactions: string[]; // Clearing transaction IDs
  settlementDate: Date;
}

export class GalaxiaClearingClient {
  private baseUrl: string;
  private quantumEnabled: boolean;
  private complianceEnabled: boolean;

  constructor(config: {
    quantum?: boolean;
    compliance?: string[];
    signature?: string;
    baseUrl?: string;
  } = {}) {
    this.baseUrl = config.baseUrl || process.env.GALAXIA_CLEARING_URL || 'https://clearing.galaxia.io';
    this.quantumEnabled = config.quantum !== false;
    this.complianceEnabled = true; // Always enabled for clearing
  }

  /**
   * Submit transaction for clearing
   */
  async submitTransaction(transaction: ClearingTransaction): Promise<ClearingResult> {
    try {
      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'Content-Type': 'application/json'
      };

      // Add quantum security headers
      if (this.quantumEnabled) {
        const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
        Object.assign(headers, quantumHeaders);
      }

      // Add compliance headers
      if (this.complianceEnabled) {
        headers['X-Compliance-Required'] = 'true';
        headers['X-Compliance-Jurisdictions'] = 'US,UK,MiCA';
      }

      const response = await fetch(`${this.baseUrl}/api/v1/transactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...transaction,
          timestamp: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(30000) // 30s timeout for clearing
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Clearing API error: ${response.status}`);
      }

      const data: any = await response.json();

      return {
        id: data.id,
        status: data.status,
        netAmount: data.net_amount,
        settlementDate: data.settlement_date ? new Date(data.settlement_date) : undefined,
        transactionHash: data.transaction_hash,
        complianceStatus: data.compliance_status,
        error: data.error
      };
    } catch (error: any) {
      logger.error('Clearing transaction submission failed', {
        transaction: transaction.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(clearingId: string): Promise<ClearingResult> {
    try {
      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0'
      };

      if (this.quantumEnabled) {
        const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
        Object.assign(headers, quantumHeaders);
      }

      const response = await fetch(`${this.baseUrl}/api/v1/transactions/${clearingId}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Clearing API error: ${response.status}`);
      }

      const data: any = await response.json();

      return {
        id: data.id,
        status: data.status,
        netAmount: data.net_amount,
        settlementDate: data.settlement_date ? new Date(data.settlement_date) : undefined,
        transactionHash: data.transaction_hash,
        complianceStatus: data.compliance_status,
        error: data.error
      };
    } catch (error: any) {
      logger.error('Clearing status check failed', {
        clearingId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Wait for settlement
   */
  async awaitSettlement(
    clearingId: string,
    timeout: number = 300000, // 5 minutes default
    pollInterval: number = 5000 // 5 seconds
  ): Promise<ClearingResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getTransactionStatus(clearingId);

      if (status.status === 'settled') {
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Clearing failed: ${status.error || 'Unknown error'}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Settlement timeout');
  }

  /**
   * Submit batch of transactions for netting
   */
  async submitNetting(transactions: ClearingTransaction[]): Promise<NettingResult> {
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

      const response = await fetch(`${this.baseUrl}/api/v1/netting`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ transactions }),
        signal: AbortSignal.timeout(60000) // 60s timeout for netting
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Clearing API error: ${response.status}`);
      }

      const data: any = await response.json();

      return {
        netAmount: data.net_amount,
        participantCount: data.participant_count,
        transactions: data.transaction_ids,
        settlementDate: new Date(data.settlement_date)
      };
    } catch (error: any) {
      logger.error('Netting submission failed', {
        transactionCount: transactions.length,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
