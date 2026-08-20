/**
 * Galaxia ID Integration
 * Unified authentication service for Galaxia ecosystem
 */

import { getGalaxiaEcosystem } from './ecosystem';
import { logger } from '../../index';

export interface GalaxiaIdUser {
  id: string;
  address: string;
  walletType: 'near' | 'solana' | 'ton' | 'galaxia';
  email?: string;
  profile?: {
    name?: string;
    avatar?: string;
  };
}

export interface GalaxiaIdToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export class GalaxiaIdService {
  private ecosystem = getGalaxiaEcosystem();

  /**
   * Authenticate user with wallet signature
   */
  async authenticateWithWallet(
    address: string,
    walletType: 'near' | 'solana' | 'ton',
    signature: string,
    message: string
  ): Promise<GalaxiaIdToken> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GalaxiaIdToken;
      }>('POST', '/v1/auth/wallet', {
        address,
        walletType,
        signature,
        message,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Galaxia ID authentication failed', { address, walletType, error: error.message });
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Get user profile from Galaxia ID
   */
  async getUserProfile(accessToken: string): Promise<GalaxiaIdUser> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GalaxiaIdUser;
      }>('GET', '/v1/auth/profile', undefined, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error('Failed to get user profile', { error: error.message });
      throw new Error(`Failed to get user profile: ${error.message}`);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<GalaxiaIdToken> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GalaxiaIdToken;
      }>('POST', '/v1/auth/refresh', {
        refreshToken,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Token refresh failed', { error: error.message });
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Verify JWT token from Galaxia ID
   */
  async verifyToken(token: string): Promise<GalaxiaIdUser> {
    try {
      const response = await this.ecosystem.request<{
        success: boolean;
        data: GalaxiaIdUser;
      }>('GET', '/v1/auth/verify', undefined, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      logger.error('Token verification failed', { error: error.message });
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }
}

export const galaxiaIdService = new GalaxiaIdService();

