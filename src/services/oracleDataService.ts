/**
 * Oracle Data Service
 * Integrates Galaxia Oracle for real-time data feeds
 */

import { galaxiaOracle } from '../config/galaxia';
import { logger } from '../index';

export class OracleDataService {
  private priceCache: Map<string, { value: number; timestamp: Date }> = new Map();
  private cacheTTL: number = 60000; // 1 minute

  /**
   * Get GXA/USD price from Oracle
   */
  async getGXAPrice(): Promise<number> {
    try {
      // Check cache first
      const cached = this.priceCache.get('GXA/USD');
      if (cached && Date.now() - cached.timestamp.getTime() < this.cacheTTL) {
        return cached.value;
      }

      const feed = await galaxiaOracle.getDataFeed('GXA/USD', {
        validate: true,
        requireConsensus: true,
        minConsensus: 0.8
      });

      const price = parseFloat(feed.value.toString());
      
      // Update cache
      this.priceCache.set('GXA/USD', {
        value: price,
        timestamp: feed.timestamp
      });

      return price;
    } catch (error: any) {
      logger.error('Oracle price fetch failed', { error: error.message });
      
      // Return cached value if available, even if expired
      const cached = this.priceCache.get('GXA/USD');
      if (cached) {
        logger.warn('Using cached price due to Oracle failure');
        return cached.value;
      }
      
      throw error;
    }
  }

  /**
   * Get multiple price feeds
   */
  async getPriceFeeds(feedIds: string[]): Promise<Map<string, number>> {
    const feeds = await galaxiaOracle.getMultipleFeeds(feedIds);
    const prices = new Map<string, number>();
    
    feeds.forEach((feed, feedId) => {
      prices.set(feedId, parseFloat(feed.value.toString()));
    });
    
    return prices;
  }

  /**
   * Subscribe to price updates
   */
  subscribeToPrice(
    feedId: string,
    callback: (price: number) => void,
    interval: number = 60000
  ): void {
    galaxiaOracle.subscribe(feedId, (feed) => {
      const price = parseFloat(feed.value.toString());
      callback(price);
      
      // Update cache
      this.priceCache.set(feedId, {
        value: price,
        timestamp: feed.timestamp
      });
    }, interval);
  }

  /**
   * Get task cost in USD using Oracle price
   */
  async getTaskCostUSD(taskCostGXA: number): Promise<number> {
    const gxaPrice = await this.getGXAPrice();
    return taskCostGXA * gxaPrice;
  }
}

export const oracleDataService = new OracleDataService();
