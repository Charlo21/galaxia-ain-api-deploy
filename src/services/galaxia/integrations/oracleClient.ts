/**
 * Galaxia Oracle Client
 * Real-time data feeds, price oracles, and external data verification services
 */

import { ecosystemService } from '../ecosystem';
import { quantumSecurityService } from '../quantumSecurity';
import { logger } from '../../../index';

export interface OracleDataFeed {
  feedId: string;
  dataType: 'price' | 'weather' | 'sports' | 'custom';
  value: any;
  timestamp: Date;
  attestation?: string; // Quantum-secure attestation
  consensus?: number; // Consensus score (0-1)
}

export interface OracleSubscription {
  feedId: string;
  callback?: (data: OracleDataFeed) => void;
  interval?: number;
}

export class GalaxiaOracleClient {
  private baseUrl: string;
  private quantumEnabled: boolean;
  private subscriptions: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: {
    quantum?: boolean;
    compliance?: string[];
    encryption?: string;
    baseUrl?: string;
  } = {}) {
    this.baseUrl = config.baseUrl || process.env.GALAXIA_ORACLE_URL || 'https://oracle.galaxia.io';
    this.quantumEnabled = config.quantum !== false;
  }

  /**
   * Get data feed from Oracle
   */
  async getDataFeed(feedId: string, options?: {
    validate?: boolean;
    requireConsensus?: boolean;
    minConsensus?: number;
  }): Promise<OracleDataFeed> {
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

      const response = await fetch(`${this.baseUrl}/api/v1/feeds/${feedId}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000) // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`Oracle API error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();

      // Validate attestation if quantum enabled
      if (this.quantumEnabled && data.attestation && options?.validate) {
        const isValid = await quantumSecurityService.verifyAttestation(
          data.attestation,
          JSON.stringify(data.value)
        );
        if (!isValid) {
          throw new Error('Oracle attestation verification failed');
        }
      }

      // Check consensus if required
      if (options?.requireConsensus && data.consensus !== undefined) {
        const minConsensus = options.minConsensus || 0.8;
        if (data.consensus < minConsensus) {
          logger.warn('Oracle data consensus below threshold', {
            feedId,
            consensus: data.consensus,
            threshold: minConsensus
          });
        }
      }

      return {
        feedId: data.feed_id || feedId,
        dataType: data.data_type || 'custom',
        value: data.value,
        timestamp: new Date(data.timestamp),
        attestation: data.attestation,
        consensus: data.consensus
      };
    } catch (error: any) {
      logger.error('Oracle data feed fetch failed', {
        feedId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Subscribe to data feed updates
   */
  subscribe(
    feedId: string,
    callback: (data: OracleDataFeed) => void,
    interval: number = 60000 // 1 minute default
  ): OracleSubscription {
    const subscription: OracleSubscription = {
      feedId,
      callback,
      interval
    };

    // Clear existing subscription if any
    if (this.subscriptions.has(feedId)) {
      clearInterval(this.subscriptions.get(feedId)!);
    }

    // Set up polling
    const pollInterval = setInterval(async () => {
      try {
        const data = await this.getDataFeed(feedId, { validate: true });
        callback(data);
      } catch (error: any) {
        logger.error('Oracle subscription poll failed', {
          feedId,
          error: error.message
        });
      }
    }, interval);

    this.subscriptions.set(feedId, pollInterval);

    return subscription;
  }

  /**
   * Unsubscribe from data feed
   */
  unsubscribe(feedId: string): void {
    const interval = this.subscriptions.get(feedId);
    if (interval) {
      clearInterval(interval);
      this.subscriptions.delete(feedId);
    }
  }

  /**
   * Get multiple data feeds at once
   */
  async getMultipleFeeds(feedIds: string[]): Promise<Map<string, OracleDataFeed>> {
    const results = new Map<string, OracleDataFeed>();
    
    await Promise.all(
      feedIds.map(async (feedId) => {
        try {
          const data = await this.getDataFeed(feedId);
          results.set(feedId, data);
        } catch (error: any) {
          logger.warn('Failed to fetch feed', { feedId, error: error.message });
        }
      })
    );

    return results;
  }

  /**
   * Verify data attestation
   */
  async verifyAttestation(attestation: string, data: any): Promise<boolean> {
    if (!this.quantumEnabled) {
      return true; // Skip verification if quantum disabled
    }

    return await quantumSecurityService.verifyAttestation(
      attestation,
      JSON.stringify(data)
    );
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
