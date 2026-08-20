/**
 * Galaxia Ecosystem Integration Service
 * Central service for connecting with Galaxia ecosystem services
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../index';

export interface GalaxiaConfig {
  apiBaseUrl: string;
  appName: string;
  appVersion: string;
  chainId: string;
  apiKey?: string;
}

export class GalaxiaEcosystemService {
  private client: AxiosInstance;
  private config: GalaxiaConfig;

  constructor(config: GalaxiaConfig) {
    this.config = config;
    
    this.client = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: 30000,
      headers: {
        'X-Galaxia-App': config.appName,
        'X-Galaxia-Version': config.appVersion,
        'X-Galaxia-Chain-ID': config.chainId,
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Galaxia API request', { url: config.url, method: config.method });
        return config;
      },
      (error) => {
        logger.error('Galaxia API request error', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Galaxia API response error', {
          status: error.response?.status,
          data: error.response?.data,
          url: error.config?.url,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Make a request to a Galaxia service with error handling
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    config?: any
  ): Promise<T> {
    try {
      const response = await this.client.request<T>({
        method,
        url: endpoint,
        data,
        ...config,
      });

      // Check for Galaxia standard response format
      const payload = response.data as Record<string, unknown>;
      if (payload && typeof payload === 'object' && 'success' in payload) {
        if (!payload.success) {
          throw new Error((payload.error as string) || 'Galaxia service error');
        }
        return (payload.data ?? payload) as T;
      }

      return response.data;
    } catch (error: any) {
      // Implement graceful degradation
      logger.error('Galaxia service request failed', {
        endpoint,
        method,
        error: error.message,
      });

      // Re-throw with context
      throw new Error(`Galaxia ${endpoint} failed: ${error.message}`);
    }
  }

  /**
   * Health check for Galaxia service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
let ecosystemService: GalaxiaEcosystemService | null = null;

export function initializeGalaxiaEcosystem(config: GalaxiaConfig): GalaxiaEcosystemService {
  ecosystemService = new GalaxiaEcosystemService(config);
  return ecosystemService;
}

export { ecosystemService };

export function getGalaxiaEcosystem(): GalaxiaEcosystemService {
  if (!ecosystemService) {
    throw new Error('Galaxia ecosystem not initialized. Call initializeGalaxiaEcosystem first.');
  }
  return ecosystemService;
}

