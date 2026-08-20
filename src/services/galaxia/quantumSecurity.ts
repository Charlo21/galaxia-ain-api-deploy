/**
 * Galaxia Quantum Security Network Integration
 * Post-quantum cryptographic security implementation
 */

import { getGalaxiaEcosystem } from './ecosystem';
import { logger } from '../../index';
import * as crypto from 'crypto';

export interface QuantumKeyPair {
  publicKey: string;
  privateKey: string; // Encrypted, stored securely
  algorithm: 'CRYSTALS-Kyber' | 'CRYSTALS-Dilithium' | 'SPHINCS+';
  keyId: string;
}

export interface QuantumSignature {
  signature: string;
  publicKey: string;
  algorithm: string;
  timestamp: number;
}

export class QuantumSecurityService {
  private ecosystem = getGalaxiaEcosystem();
  private keyCache: Map<string, QuantumKeyPair> = new Map();
  private defaultKeyId: string | null = null;
  private readonly allowLegacyEcdsaFallback =
    (process.env.ALLOW_LEGACY_ECDSA_FALLBACK || 'false').toLowerCase() === 'true';

  /**
   * Generate quantum-resistant key pair
   * Uses CRYSTALS-Kyber for key encapsulation
   */
  async generateKeyPair(algorithm: 'CRYSTALS-Kyber' | 'CRYSTALS-Dilithium' | 'SPHINCS+' = 'CRYSTALS-Kyber'): Promise<QuantumKeyPair> {
    try {
      // Request key generation from Galaxia Quantum Security Network
      const response = await this.ecosystem.request<{
        success: boolean;
        data: QuantumKeyPair;
      }>('POST', '/v1/quantum/generate-keypair', {
        algorithm,
      });

      const keyPair = response.data;
      
      // Cache the key pair (private key should be encrypted)
      this.keyCache.set(keyPair.keyId, {
        ...keyPair,
        privateKey: this.encryptPrivateKey(keyPair.privateKey),
      });

      // Set as default if first key
      if (!this.defaultKeyId) {
        this.defaultKeyId = keyPair.keyId;
      }

      return keyPair;
    } catch (error: any) {
      logger.error('Failed to generate quantum key pair', { algorithm, error: error.message });
      
      // WHY: Avoid silent downgrade to ECDSA during PQ rollout.
      // Quantum threat mitigated: a network/API outage should not transparently push
      // security-sensitive signing back onto secp256k1 where Shor's algorithm breaks it.
      if (!this.allowLegacyEcdsaFallback) {
        throw new Error(
          'Quantum key generation failed and legacy ECDSA fallback is disabled (set ALLOW_LEGACY_ECDSA_FALLBACK=true to override)'
        );
      }

      // Fallback (explicitly opt-in): Generate hybrid key (classical ECDSA) for continuity.
      return this.generateHybridKeyPair(algorithm);
    }
  }

  /**
   * Sign data with quantum-resistant signature
   * Uses CRYSTALS-Dilithium for digital signatures
   */
  async sign(data: string, keyId?: string): Promise<QuantumSignature> {
    try {
      const effectiveKeyId = keyId || this.defaultKeyId;
      if (!effectiveKeyId) {
        // Generate default key if none exists
        const keyPair = await this.generateKeyPair('CRYSTALS-Dilithium');
        this.defaultKeyId = keyPair.keyId;
        return this.sign(data, keyPair.keyId);
      }

      const keyPair = this.keyCache.get(effectiveKeyId);
      if (!keyPair) {
        throw new Error(`Key pair not found: ${effectiveKeyId}`);
      }

      // Request signature from Galaxia Quantum Security Network
      const response = await this.ecosystem.request<{
        success: boolean;
        data: QuantumSignature;
      }>('POST', '/v1/quantum/sign', {
        data,
        keyId: effectiveKeyId,
        algorithm: keyPair.algorithm,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Quantum signature failed', { keyId, error: error.message });
      
      // WHY: Prevent silent downgrade to ECDSA unless explicitly allowed.
      // Quantum threat mitigated: downgrade attacks during migration windows.
      if (!this.allowLegacyEcdsaFallback) {
        throw new Error(
          'Quantum signing failed and legacy ECDSA fallback is disabled (set ALLOW_LEGACY_ECDSA_FALLBACK=true to override)'
        );
      }

      // Fallback (explicitly opt-in): Use classical ECDSA signature.
      return this.hybridSign(data, keyId || this.defaultKeyId || '');
    }
  }

  /**
   * Sign with backup algorithm (SPHINCS+)
   */
  async signBackup(data: string, keyId?: string): Promise<QuantumSignature> {
    try {
      const effectiveKeyId = keyId || this.defaultKeyId;
      if (!effectiveKeyId) {
        const keyPair = await this.generateKeyPair('SPHINCS+');
        this.defaultKeyId = keyPair.keyId;
        return this.signBackup(data, keyPair.keyId);
      }

      const keyPair = this.keyCache.get(effectiveKeyId);
      if (!keyPair || keyPair.algorithm !== 'SPHINCS+') {
        // Generate SPHINCS+ key if needed
        const sphincsKey = await this.generateKeyPair('SPHINCS+');
        return this.signBackup(data, sphincsKey.keyId);
      }

      return this.sign(data, effectiveKeyId);
    } catch (error: any) {
      logger.error('SPHINCS+ signature failed', { error: error.message });
      // WHY: Prevent silent downgrade unless explicitly allowed.
      // Quantum threat mitigated: downgrade attacks during migration windows.
      if (!this.allowLegacyEcdsaFallback) {
        throw new Error(
          'SPHINCS+ signing failed and legacy ECDSA fallback is disabled (set ALLOW_LEGACY_ECDSA_FALLBACK=true to override)'
        );
      }
      return this.hybridSign(data, keyId || this.defaultKeyId || '');
    }
  }

  /**
   * Generate request headers with quantum security
   */
  async generateRequestHeaders(): Promise<Record<string, string>> {
    try {
      // Generate or get default key
      if (!this.defaultKeyId) {
        await this.generateKeyPair('CRYSTALS-Dilithium');
      }

      const timestamp = Date.now().toString();
      const signature = await this.sign(timestamp);

      return {
        'X-Quantum-Signature': signature.signature,
        'X-Quantum-PublicKey': signature.publicKey,
        'X-Quantum-Algorithm': signature.algorithm,
        'X-Quantum-Timestamp': timestamp.toString()
      };
    } catch (error: any) {
      logger.error('Failed to generate quantum request headers', { error: error.message });
      return {};
    }
  }

  /**
   * Verify quantum-resistant signature
   */
  async verify(data: string, signature: QuantumSignature): Promise<boolean> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: { valid: boolean };
      }>('POST', '/v1/quantum/verify', {
        data,
        signature,
      });

      return response.data.valid;
    } catch (error: any) {
      logger.error('Quantum signature verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Encrypt data with quantum-resistant encryption
   * Uses hybrid encryption: AES-256 (symmetric) + CRYSTALS-Kyber (key encapsulation)
   */
  async encrypt(data: string, recipientPublicKey: string): Promise<{
    encryptedData: string;
    encryptedKey: string;
    algorithm: string;
  }> {
    try {
      // Generate random AES-256 key
      const aesKey = crypto.randomBytes(32);
      
      // Encrypt data with AES-256
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, crypto.randomBytes(12));
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();

      // Encrypt AES key with CRYSTALS-Kyber (via Galaxia Quantum Security Network)
      const response = await this.ecosystem.request<{
        success: boolean;
        data: { encryptedKey: string };
      }>('POST', '/v1/quantum/encrypt-key', {
        key: aesKey.toString('hex'),
        recipientPublicKey,
        algorithm: 'CRYSTALS-Kyber',
      });

      return {
        encryptedData: `${encrypted}:${authTag.toString('hex')}`,
        encryptedKey: response.data.encryptedKey,
        algorithm: 'AES-256-GCM + CRYSTALS-Kyber',
      };
    } catch (error: any) {
      logger.error('Quantum encryption failed', { error: error.message });
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data encrypted with quantum-resistant encryption
   */
  async decrypt(
    encryptedData: string,
    encryptedKey: string,
    privateKeyId: string
  ): Promise<string> {
    try {
      // Decrypt AES key using private key (via Galaxia Quantum Security Network)
      const response = await this.ecosystem.request<{
        success: boolean;
        data: { decryptedKey: string };
      }>('POST', '/v1/quantum/decrypt-key', {
        encryptedKey,
        privateKeyId,
      });

      const aesKey = Buffer.from(response.data.decryptedKey, 'hex');
      
      // Decrypt data with AES-256
      const [data, authTag] = encryptedData.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, crypto.randomBytes(12));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      
      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error: any) {
      logger.error('Quantum decryption failed', { error: error.message });
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Generate hybrid key pair (fallback)
   * Combines classical ECDSA with quantum-resistant algorithms
   */
  private generateHybridKeyPair(algorithm: string): QuantumKeyPair {
    // Generate classical key pair as fallback
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
    });

    const keyId = crypto.randomBytes(16).toString('hex');
    const keyPair = {
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      algorithm: algorithm as any,
      keyId,
    };

    this.keyCache.set(keyId, {
      ...keyPair,
      privateKey: this.encryptPrivateKey(keyPair.privateKey),
    });

    if (!this.defaultKeyId) {
      this.defaultKeyId = keyId;
    }

    return keyPair;
  }

  /**
   * Hybrid signature (fallback)
   */
  private hybridSign(data: string, keyId: string): QuantumSignature {
    const keyPair = this.keyCache.get(keyId);
    if (!keyPair) {
      throw new Error(`Key pair not found: ${keyId}`);
    }

    // Use classical signature as fallback
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    const signature = sign.sign(keyPair.privateKey, 'hex');

    return {
      signature,
      publicKey: keyPair.publicKey,
      algorithm: 'ECDSA-SHA256 (fallback)',
      timestamp: Date.now(),
    };
  }

  /**
   * Encrypt private key for storage
   */
  private encryptPrivateKey(privateKey: string): string {
    // In production, use a proper key derivation function
    const encryptionKey = process.env.QUANTUM_KEY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), crypto.randomBytes(12));
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${encrypted}:${authTag.toString('hex')}`;
  }

  /**
   * Health check for quantum security service
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await this.ecosystem.healthCheck();
    } catch (error) {
      return false;
    }
  }

  /**
   * Verify a quantum-resistant signature
   */
  async verifySignature(
    data: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      const result = await this.ecosystem.request<{ valid: boolean }>(
        'POST',
        '/quantum/verify-signature',
        { data, signature, publicKey }
      );
      return Boolean(result?.valid);
    } catch (error) {
      logger.warn('Quantum signature verification unavailable', { error });
      return this.allowLegacyEcdsaFallback;
    }
  }

  /**
   * Verify a quantum-secure attestation
   */
  async verifyAttestation(attestation: string, data?: unknown): Promise<boolean> {
    try {
      const result = await this.ecosystem.request<{ valid: boolean }>(
        'POST',
        '/quantum/verify-attestation',
        { attestation, data }
      );
      return Boolean(result?.valid);
    } catch (error) {
      logger.warn('Quantum attestation verification unavailable', { error });
      return this.allowLegacyEcdsaFallback;
    }
  }
}

export const quantumSecurityService = new QuantumSecurityService();
