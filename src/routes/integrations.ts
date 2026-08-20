/**
 * Integration Routes
 * Endpoints for interacting with new Galaxia applications
 */

import express, { Response } from 'express';
import { authenticateApiKey, AuthenticatedRequest } from '../middleware/auth';
import { galaxiaOracle, galaxiaClearing, constellationL1, nebulaStudio, bitcoinQuantumShield } from '../config/galaxia';
import { oracleDataService } from '../services/oracleDataService';
import { logger } from '../index';

const router = express.Router();

// ============================================================================
// ORACLE ENDPOINTS
// ============================================================================

/**
 * GET /v1/integrations/oracle/price/:feedId
 * Get price feed from Galaxia Oracle
 */
router.get('/oracle/price/:feedId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const feedId = req.params.feedId;
    const feed = await galaxiaOracle.getDataFeed(feedId, {
      validate: true,
      requireConsensus: true
    });

    res.json({
      success: true,
      feed: {
        feedId: feed.feedId,
        value: feed.value,
        timestamp: feed.timestamp,
        consensus: feed.consensus
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/integrations/oracle/gxa-price
 * Get GXA/USD price
 */
router.get('/oracle/gxa-price', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const price = await oracleDataService.getGXAPrice();
    res.json({ success: true, price, currency: 'USD' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CLEARING ENDPOINTS
// ============================================================================

/**
 * GET /v1/integrations/clearing/status/:clearingId
 * Get clearing transaction status
 */
router.get('/clearing/status/:clearingId', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clearingId = req.params.clearingId;
    const status = await galaxiaClearing.getTransactionStatus(clearingId);

    res.json({
      success: true,
      clearing: {
        id: status.id,
        status: status.status,
        netAmount: status.netAmount,
        settlementDate: status.settlementDate,
        transactionHash: status.transactionHash,
        complianceStatus: status.complianceStatus
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CONSTELLATION L1 ENDPOINTS
// ============================================================================

/**
 * GET /v1/integrations/constellation/balance/:address
 * Get balance on Constellation L1
 */
router.get('/constellation/balance/:address', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const address = req.params.address;
    const currency = req.query.currency as string | undefined;
    const balance = await constellationL1.getBalance(address, currency);

    res.json({
      success: true,
      balance,
      currency: currency || 'GXA',
      address
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/integrations/constellation/block/:blockNumber
 * Get block information
 */
router.get('/constellation/block/:blockNumber', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const blockNumber = req.params.blockNumber === 'latest' 
      ? 'latest' 
      : parseInt(req.params.blockNumber);
    
    const block = await constellationL1.getBlock(blockNumber);

    res.json({
      success: true,
      block: {
        number: block.number,
        hash: block.hash,
        timestamp: block.timestamp,
        transactionCount: block.transactions.length,
        gasUsed: block.gasUsed,
        gasLimit: block.gasLimit
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /v1/integrations/constellation/transaction/:txHash
 * Get transaction status
 */
router.get('/constellation/transaction/:txHash', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const txHash = req.params.txHash;
    const status = await constellationL1.getTransactionStatus(txHash);

    res.json({
      success: true,
      transaction: {
        hash: status.hash,
        status: status.status,
        blockNumber: status.blockNumber,
        confirmations: status.confirmations,
        gasUsed: status.gasUsed
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BITCOIN QUANTUM SHIELD ENDPOINTS
// ============================================================================

/**
 * GET /v1/integrations/bitcoin/balance/:address
 * Get Bitcoin balance with quantum-safe verification
 */
router.get('/bitcoin/balance/:address', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const address = req.params.address;
    const balance = await bitcoinQuantumShield.getBalance(address);

    res.json({
      success: true,
      balance,
      currency: 'BTC',
      address,
      quantumProtected: true
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// HEALTH CHECKS
// ============================================================================

/**
 * GET /v1/integrations/health
 * Health check for all integrated services
 */
router.get('/health', authenticateApiKey, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [oracle, clearing, constellation, nebula, btcShield] = await Promise.all([
      galaxiaOracle.healthCheck(),
      galaxiaClearing.healthCheck(),
      constellationL1.healthCheck(),
      nebulaStudio.healthCheck(),
      bitcoinQuantumShield.healthCheck()
    ]);

    res.json({
      success: true,
      services: {
        oracle: oracle ? 'healthy' : 'unhealthy',
        clearing: clearing ? 'healthy' : 'unhealthy',
        constellation: constellation ? 'healthy' : 'unhealthy',
        nebula: nebula ? 'healthy' : 'unhealthy',
        bitcoinQuantumShield: btcShield ? 'healthy' : 'unhealthy'
      },
      allHealthy: oracle && clearing && constellation && nebula && btcShield
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
