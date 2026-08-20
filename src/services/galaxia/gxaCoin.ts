/**
 * GXA Coin Integration
 * Primary token for Galaxia ecosystem transactions
 */

import { getGalaxiaEcosystem } from './ecosystem';
import { logger } from '../../index';

export interface GXATransaction {
  id: string;
  from: string;
  to: string;
  amount: string;
  token: 'GXA';
  chainId: string;
  status: 'pending' | 'confirmed' | 'failed';
  txHash?: string;
  timestamp: number;
}

export interface GXABalance {
  address: string;
  balance: string;
  available: string;
  locked: string;
  token: 'GXA';
}

export class GXACoinService {
  private ecosystem = getGalaxiaEcosystem();

  /**
   * Get GXA balance for an address
   */
  async getBalance(address: string, chainId?: string): Promise<GXABalance> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GXABalance;
      }>('GET', `/v1/gxa/balance/${address}${chainId ? `?chainId=${chainId}` : ''}`, undefined);

      return response.data;
    } catch (error: any) {
      logger.error('Failed to get GXA balance', { address, error: error.message });
      // Graceful degradation: return zero balance
      return {
        address,
        balance: '0',
        available: '0',
        locked: '0',
        token: 'GXA',
      };
    }
  }

  /**
   * Transfer GXA tokens
   */
  async transfer(
    from: string,
    to: string,
    amount: string,
    signature: string,
    chainId?: string
  ): Promise<GXATransaction> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GXATransaction;
      }>('POST', '/v1/gxa/transfer', {
        from,
        to,
        amount,
        signature,
        chainId,
      });

      return response.data;
    } catch (error: any) {
      logger.error('GXA transfer failed', { from, to, amount, error: error.message });
      throw new Error(`GXA transfer failed: ${error.message}`);
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(txId: string): Promise<GXATransaction> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GXATransaction;
      }>('GET', `/v1/gxa/transaction/${txId}`);

      return response.data;
    } catch (error: any) {
      logger.error('Failed to get transaction status', { txId, error: error.message });
      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }

  /**
   * Estimate transaction fee
   */
  async estimateFee(amount: string, chainId?: string): Promise<string> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: { fee: string };
      }>('POST', '/v1/gxa/estimate-fee', {
        amount,
        chainId,
      });

      return response.data.fee;
    } catch (error: any) {
      logger.error('Failed to estimate fee', { amount, error: error.message });
      // Default fee estimate
      return '0.001';
    }
  }
}

export const gxaCoinService = new GXACoinService();

