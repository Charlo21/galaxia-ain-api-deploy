/**
 * Bitcoin Quantum Shield Client
 * Quantum-resistant security layer for Bitcoin transactions and wallets
 */

import { ecosystemService } from '../ecosystem';
import { quantumSecurityService } from '../quantumSecurity';
import { logger } from '../../../index';

export interface BitcoinTransaction {
  from: string;
  to: string;
  amount: number; // in BTC
  fee?: number;
  data?: string;
}

export interface ProtectedTransaction {
  transaction: BitcoinTransaction;
  quantumSignature: string; // CRYSTALS-Dilithium signature
  quantumKeyExchange: string; // Kyber-encapsulated key
  attestation: string;
  timestamp: Date;
}

export interface QuantumSafeAddress {
  address: string;
  publicKey: string;
  quantumPublicKey: string; // Post-quantum public key
  derivationPath?: string;
}

export interface MultiSigConfig {
  requiredSignatures: number;
  totalSignatures: number;
  participants: Array<{
    address: string;
    quantumPublicKey: string;
  }>;
}

export class BitcoinQuantumShieldClient {
  private baseUrl: string;
  private quantumEnabled: boolean;
  private network: 'mainnet' | 'testnet';

  constructor(config: {
    quantum?: boolean;
    network?: 'mainnet' | 'testnet';
    baseUrl?: string;
  } = {}) {
    this.network = config.network || (process.env.BTC_NETWORK as 'mainnet' | 'testnet') || 'mainnet';
    this.baseUrl = config.baseUrl || process.env.BITCOIN_QUANTUM_SHIELD_URL || 'https://btc-shield.galaxia.io';
    this.quantumEnabled = config.quantum !== false;
  }

  /**
   * Sign Bitcoin transaction with quantum-safe signature
   */
  async signTransaction(transaction: BitcoinTransaction): Promise<ProtectedTransaction> {
    try {
      if (!this.quantumEnabled) {
        throw new Error('Quantum Shield requires quantum security to be enabled');
      }

      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'Content-Type': 'application/json',
        'X-Quantum-Enabled': 'true',
        'X-Network': this.network
      };

      // Generate quantum security headers
      const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
      Object.assign(headers, quantumHeaders);

      const response = await fetch(`${this.baseUrl}/api/v1/transactions/sign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...transaction,
          network: this.network,
          timestamp: Date.now()
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Bitcoin Quantum Shield API error: ${response.status}`);
      }

      const data: any = await response.json();

      return {
        transaction: data.transaction,
        quantumSignature: data.quantum_signature,
        quantumKeyExchange: data.quantum_key_exchange,
        attestation: data.attestation,
        timestamp: new Date(data.timestamp)
      };
    } catch (error: any) {
      logger.error('Bitcoin Quantum Shield transaction signing failed', {
        from: transaction.from,
        to: transaction.to,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate quantum-safe Bitcoin address
   */
  async generateAddress(): Promise<QuantumSafeAddress> {
    try {
      if (!this.quantumEnabled) {
        throw new Error('Quantum Shield requires quantum security to be enabled');
      }

      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'X-Quantum-Enabled': 'true',
        'X-Network': this.network
      };

      const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
      Object.assign(headers, quantumHeaders);

      const response = await fetch(`${this.baseUrl}/api/v1/addresses/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          network: this.network
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Bitcoin Quantum Shield API error: ${response.status}`);
      }

      const data: any = await response.json();

      return {
        address: data.address,
        publicKey: data.public_key,
        quantumPublicKey: data.quantum_public_key,
        derivationPath: data.derivation_path
      };
    } catch (error: any) {
      logger.error('Bitcoin Quantum Shield address generation failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verify quantum-safe Bitcoin transaction
   */
  async verifyTransaction(protectedTx: ProtectedTransaction): Promise<boolean> {
    try {
      if (!this.quantumEnabled) {
        return false;
      }

      // Verify quantum signature
      const signatureValid = await quantumSecurityService.verifySignature(
        protectedTx.quantumSignature,
        JSON.stringify(protectedTx.transaction),
        protectedTx.transaction.from // Use from address as public key identifier
      );

      // Verify attestation
      const attestationValid = await quantumSecurityService.verifyAttestation(
        protectedTx.attestation,
        JSON.stringify(protectedTx.transaction)
      );

      return signatureValid && attestationValid;
    } catch (error: any) {
      logger.error('Bitcoin Quantum Shield transaction verification failed', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get Bitcoin balance with quantum-safe verification
   */
  async getBalance(address: string): Promise<number> {
    try {
      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'X-Quantum-Enabled': 'true',
        'X-Network': this.network
      };

      if (this.quantumEnabled) {
        const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
        Object.assign(headers, quantumHeaders);
      }

      const response = await fetch(`${this.baseUrl}/api/v1/addresses/${address}/balance`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Bitcoin Quantum Shield API error: ${response.status}`);
      }

      const data: any = await response.json();
      return parseFloat(data.balance || '0');
    } catch (error: any) {
      logger.error('Bitcoin Quantum Shield balance fetch failed', {
        address,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create quantum-safe multi-signature wallet
   */
  async createMultiSig(config: MultiSigConfig): Promise<{
    address: string;
    redeemScript: string;
    quantumPublicKeys: string[];
  }> {
    try {
      if (!this.quantumEnabled) {
        throw new Error('Quantum Shield requires quantum security to be enabled');
      }

      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'Content-Type': 'application/json',
        'X-Quantum-Enabled': 'true',
        'X-Network': this.network
      };

      const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
      Object.assign(headers, quantumHeaders);

      const response = await fetch(`${this.baseUrl}/api/v1/multisig/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...config,
          network: this.network
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Bitcoin Quantum Shield API error: ${response.status}`);
      }

      const data: any = await response.json();

      return {
        address: data.address,
        redeemScript: data.redeem_script,
        quantumPublicKeys: data.quantum_public_keys
      };
    } catch (error: any) {
      logger.error('Bitcoin Quantum Shield multisig creation failed', {
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
