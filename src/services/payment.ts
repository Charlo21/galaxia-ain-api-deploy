import { pool } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { gxaCoinService } from './galaxia/gxaCoin';
import { logger } from '../index';
import { isKYCRequired, getTransactionLimits, getKYCProfile } from './compliance/kycService';
import { monitorTransaction } from './compliance/transactionMonitoring';
import { isTravelRuleRequired, createTravelRuleRecord } from './compliance/travelRule';
import { isGeoBlocked } from './compliance/jurisdictionService';
import { 
  GalaxiaClearingClient,
  GalaxiaOracleClient,
  ConstellationL1Client,
  BitcoinQuantumShieldClient
} from './galaxia/integrations';

export interface PaymentRequest {
  user_id: string;
  amount: number;
  task_id?: string;
  node_id?: string;
  transaction_type: 'deposit' | 'payment' | 'payout' | 'refund';
  wallet_address?: string; // For GXA Coin integration
}

/**
 * Process token payment with GXA Coin integration
 */
export async function processPayment(request: PaymentRequest): Promise<string> {
  const client = await pool.connect();
  const transactionId = uuidv4();
  
  try {
    // ========================================================================
    // COMPLIANCE CHECKS - Execute before processing payment
    // ========================================================================
    
    // 1. Geo-blocking check
    if (request.user_id) {
      const blocked = await isGeoBlocked(request.user_id);
      if (blocked) {
        throw new Error('Service not available in your jurisdiction');
      }
    }
    
    // 2. KYC verification check (for payments, not deposits)
    if (request.transaction_type === 'payment' && request.user_id && request.amount > 0) {
      const kycRequired = await isKYCRequired(request.user_id, request.amount);
      if (kycRequired) {
        const profile = await getKYCProfile(request.user_id);
        throw new Error(
          `KYC verification required. Current status: ${profile?.kyc_status || 'none'}. ` +
          `Please complete KYC verification to proceed with this transaction.`
        );
      }
      
      // 3. Transaction limit check
      const limits = await getTransactionLimits(request.user_id);
      
      // Check single transaction limit
      if (limits.single > 0 && request.amount > limits.single) {
        throw new Error(
          `Transaction amount (${request.amount}) exceeds single transaction limit (${limits.single}). ` +
          `Please upgrade your KYC tier or split the transaction.`
        );
      }
      
      // Check daily limit
      const dailyResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as daily_total
         FROM token_transactions
         WHERE user_id = $1
           AND transaction_type = 'payment'
           AND created_at::date = CURRENT_DATE
           AND status = 'completed'`,
        [request.user_id]
      );
      
      const dailyTotal = parseFloat(dailyResult.rows[0].daily_total || '0');
      if (limits.daily > 0 && (dailyTotal + request.amount) > limits.daily) {
        throw new Error(
          `Transaction would exceed daily limit. Daily total: ${dailyTotal}, Limit: ${limits.daily}, ` +
          `Remaining: ${limits.daily - dailyTotal}`
        );
      }
    }
    
    await client.query('BEGIN');
    
    // Get user balance
    const userResult = await client.query(
      'SELECT token_balance, wallet_address FROM users WHERE id = $1',
      [request.user_id]
    );
    
    if (userResult.rows.length === 0 && request.transaction_type !== 'deposit') {
      throw new Error('User not found');
    }
    
    let newBalance = 0;
    const walletAddress = request.wallet_address || userResult.rows[0]?.wallet_address;
    
    if (request.transaction_type === 'deposit') {
      // Check GXA Coin balance if wallet address provided
      if (walletAddress) {
        try {
          const gxaBalance = await gxaCoinService.getBalance(walletAddress);
          const availableBalance = parseFloat(gxaBalance.available);
          
          if (availableBalance < request.amount) {
            throw new Error('Insufficient GXA balance');
          }
        } catch (error: any) {
          logger.warn('GXA balance check failed, using internal balance', { error: error.message });
        }
      }
      
      // Create user if doesn't exist
      if (userResult.rows.length === 0) {
        await client.query(
          'INSERT INTO users (id, token_balance, wallet_address) VALUES ($1, $2, $3)',
          [request.user_id, request.amount, walletAddress]
        );
        newBalance = request.amount;
      } else {
        newBalance = parseFloat(userResult.rows[0].token_balance) + request.amount;
        await client.query(
          'UPDATE users SET token_balance = $1 WHERE id = $2',
          [newBalance, request.user_id]
        );
      }
    } else if (request.transaction_type === 'payment') {
      // Deduct from user balance
      const currentBalance = parseFloat(userResult.rows[0].token_balance);
      if (currentBalance < request.amount) {
        throw new Error('Insufficient balance');
      }
      newBalance = currentBalance - request.amount;
      await client.query(
        'UPDATE users SET token_balance = $1, total_spent = total_spent + $2 WHERE id = $3',
        [newBalance, request.amount, request.user_id]
      );
    } else if (request.transaction_type === 'payout') {
      // Add to node operator balance
      const nodeResult = await client.query(
        'SELECT wallet_address, total_earnings FROM nodes WHERE id = $1',
        [request.node_id]
      );
      
      if (nodeResult.rows.length === 0) {
        throw new Error('Node not found');
      }
      
      const currentEarnings = parseFloat(nodeResult.rows[0].total_earnings) || 0;
      const newEarnings = currentEarnings + request.amount;
      
      await client.query(
        'UPDATE nodes SET total_earnings = $1 WHERE id = $2',
        [newEarnings, request.node_id]
      );
      
      // Optionally transfer GXA Coin to node wallet
      const nodeWallet = nodeResult.rows[0].wallet_address;
      if (nodeWallet) {
        try {
          // In production, this would initiate a GXA transfer
          // For now, we just log it
          logger.info('GXA payout initiated', {
            nodeId: request.node_id,
            wallet: nodeWallet,
            amount: request.amount,
          });
        } catch (error: any) {
          logger.error('GXA payout failed', { error: error.message });
          // Don't fail the transaction - earnings are still recorded
        }
      }
    } else if (request.transaction_type === 'refund') {
      // Refund to user
      const currentBalance = parseFloat(userResult.rows[0].token_balance);
      newBalance = currentBalance + request.amount;
      await client.query(
        'UPDATE users SET token_balance = $1 WHERE id = $2',
        [newBalance, request.user_id]
      );
    }
    
    // Record transaction
    await client.query(
      `INSERT INTO token_transactions 
       (id, user_id, node_id, task_id, amount, transaction_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed')`,
      [
        transactionId,
        request.user_id || null,
        request.node_id || null,
        request.task_id || null,
        request.amount,
        request.transaction_type,
      ]
    );
    
    await client.query('COMMIT');
    
    // ========================================================================
    // POST-TRANSACTION COMPLIANCE PROCESSING
    // ========================================================================
    
    // 4. Transaction monitoring (async - don't block transaction)
    if (request.user_id && request.transaction_type === 'payment') {
      monitorTransaction(
        request.user_id,
        transactionId,
        request.amount,
        request.transaction_type
      ).catch(error => {
        logger.error('Transaction monitoring failed', {
          transactionId,
          error: error.message
        });
      });
    }
    
    // 5. Travel Rule compliance (for transactions above threshold)
    if (request.user_id && request.transaction_type === 'payment' && request.amount > 0) {
      try {
        const travelRuleCheck = await isTravelRuleRequired(request.amount, request.user_id);
        
        if (travelRuleCheck.required) {
          // Get user and beneficiary information for Travel Rule
          const userInfo = await client.query(
            `SELECT u.wallet_address, kp.first_name, kp.last_name, kp.country_of_residence
             FROM users u
             LEFT JOIN kyc_profiles kp ON u.id = kp.user_id
             WHERE u.id = $1`,
            [request.user_id]
          );
          
          const user = userInfo.rows[0];
          
          // Get beneficiary info (node or recipient)
          let beneficiaryInfo: any = null;
          if (request.node_id) {
            const nodeInfo = await client.query(
              'SELECT wallet_address FROM nodes WHERE id = $1',
              [request.node_id]
            );
            beneficiaryInfo = nodeInfo.rows[0];
          }
          
          if (user && beneficiaryInfo) {
            await createTravelRuleRecord(transactionId, {
              originator_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
              originator_account_number: user.wallet_address || '',
              originator_country: user.country_of_residence || 'UNK',
              beneficiary_name: 'Node Operator',
              beneficiary_account_number: beneficiaryInfo.wallet_address || '',
              beneficiary_country: 'UNK',
              transaction_amount: request.amount,
              transaction_currency: 'GXA',
              transaction_date: new Date()
            });
          }
        }
      } catch (error: any) {
        logger.error('Travel Rule record creation failed', {
          transactionId,
          error: error.message
        });
        // Don't fail transaction if Travel Rule fails
      }
    }
    
    // ========================================================================
    // NEW APPLICATION INTEGRATIONS
    // ========================================================================
    
    // 6. Submit to Galaxia Clearing for settlement (for payments and payouts)
    if ((request.transaction_type === 'payment' || request.transaction_type === 'payout') && 
        request.user_id && request.amount > 0) {
      try {
        const { galaxiaClearing } = await import('../config/galaxia');
        
        // Get user and beneficiary information
        const userInfo = await client.query(
          `SELECT u.wallet_address, kp.country_of_residence, kp.kyc_level
           FROM users u
           LEFT JOIN kyc_profiles kp ON u.id = kp.user_id
           WHERE u.id = $1`,
          [request.user_id]
        );
        
        const user = userInfo.rows[0];
        let beneficiaryId = request.node_id || request.user_id;
        
        if (request.node_id) {
          const nodeInfo = await client.query(
            'SELECT wallet_address FROM nodes WHERE id = $1',
            [request.node_id]
          );
          beneficiaryId = nodeInfo.rows[0]?.wallet_address || request.node_id;
        }
        
        const clearingResult = await galaxiaClearing.submitTransaction({
          originatorId: user?.wallet_address || request.user_id,
          beneficiaryId: beneficiaryId,
          amount: request.amount,
          currency: 'GXA',
          transactionType: request.transaction_type === 'payment' ? 'payment' : 'settlement',
          metadata: {
            internal_transaction_id: transactionId,
            task_id: request.task_id
          },
          complianceData: {
            kycLevel: user?.kyc_level,
            jurisdiction: user?.country_of_residence
          }
        });
        
        // Update transaction with clearing ID
        await client.query(
          'UPDATE token_transactions SET clearing_id = $1 WHERE id = $2',
          [clearingResult.id, transactionId]
        );
        
        logger.info('Transaction submitted to Clearing', {
          transactionId,
          clearingId: clearingResult.id,
          status: clearingResult.status
        });
        
        // If settlement is immediate, wait for it asynchronously
        if (clearingResult.status === 'pending') {
          galaxiaClearing.awaitSettlement(clearingResult.id).then(settlement => {
            logger.info('Transaction settled', {
              transactionId,
              clearingId: settlement.id,
              txHash: settlement.transactionHash
            });
          }).catch(error => {
            logger.error('Settlement failed', {
              transactionId,
              error: error.message
            });
          });
        }
      } catch (error: any) {
        logger.error('Clearing submission failed', {
          transactionId,
          error: error.message
        });
        // Don't fail transaction if clearing fails - log and continue
      }
    }
    
    // 7. Write to Constellation L1 blockchain (for significant transactions)
    if (request.transaction_type === 'payment' && request.amount >= 1000) {
      try {
        const { constellationL1 } = await import('../config/galaxia');
        
        const userInfo = await client.query(
          'SELECT wallet_address FROM users WHERE id = $1',
          [request.user_id]
        );
        
        const userWallet = userInfo.rows[0]?.wallet_address;
        if (userWallet) {
          const txResult = await constellationL1.sendTransaction({
            from: userWallet,
            to: process.env.CONSTELLATION_TREASURY_ADDRESS || '0x0000000000000000000000000000000000000000',
            amount: request.amount,
            currency: 'GXA',
            data: JSON.stringify({
              transaction_id: transactionId,
              transaction_type: request.transaction_type,
              task_id: request.task_id
            })
          });
          
          // Update transaction with blockchain hash
          await client.query(
            'UPDATE token_transactions SET blockchain_hash = $1 WHERE id = $2',
            [txResult.hash, transactionId]
          );
          
          logger.info('Transaction written to Constellation L1', {
            transactionId,
            txHash: txResult.hash
          });
        }
      } catch (error: any) {
        logger.error('Constellation L1 transaction failed', {
          transactionId,
          error: error.message
        });
        // Don't fail transaction if blockchain write fails
      }
    }
    
    // 8. Audit logging
    try {
      await client.query(
        `INSERT INTO audit_logs
           (id, user_id, ip_address, action_type, resource_type, resource_id,
            action_description, compliance_relevant, created_at)
         VALUES
           (uuid_generate_v4(), $1, NULL, 'payment_processed', 'transaction', $2,
            'Payment transaction processed', true, CURRENT_TIMESTAMP)`,
        [request.user_id || null, transactionId]
      );
    } catch (error: any) {
      logger.warn('Audit logging failed', { error: error.message });
    }
    
    return transactionId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get user balance (with GXA Coin integration)
 */
export async function getUserBalance(userId: string, walletAddress?: string): Promise<number> {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT token_balance, wallet_address FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      // Try to get GXA balance if wallet address provided
      if (walletAddress) {
        try {
          const gxaBalance = await gxaCoinService.getBalance(walletAddress);
          return parseFloat(gxaBalance.available);
        } catch (error) {
          return 0;
        }
      }
      return 0;
    }
    
    const internalBalance = parseFloat(result.rows[0].token_balance) || 0;
    const userWallet = walletAddress || result.rows[0].wallet_address;
    
    // If wallet address available, also check GXA balance
    if (userWallet) {
      try {
        const gxaBalance = await gxaCoinService.getBalance(userWallet);
        const gxaAvailable = parseFloat(gxaBalance.available);
        // Return combined balance
        return internalBalance + gxaAvailable;
      } catch (error) {
        // Fallback to internal balance only
        return internalBalance;
      }
    }
    
    return internalBalance;
  } finally {
    client.release();
  }
}

/**
 * Distribute payment to nodes after task completion
 * Uses direct payment model (no platform fees) for competitive positioning
 */
export async function distributeNodePayments(
  taskId: string,
  nodeIds: string[],
  userId?: string,
  userWallet?: string
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get task cost and user info
    const taskResult = await client.query(
      'SELECT cost_tokens, user_id FROM tasks WHERE id = $1',
      [taskId]
    );
    
    if (taskResult.rows.length === 0) return;
    
    const cost = parseFloat(taskResult.rows[0].cost_tokens);
    const taskUserId = userId || taskResult.rows[0].user_id;
    
    // Get user wallet if available
    let userWalletAddress = userWallet;
    if (!userWalletAddress && taskUserId) {
      const userResult = await client.query(
        'SELECT wallet_address FROM users WHERE id = $1',
        [taskUserId]
      );
      userWalletAddress = userResult.rows[0]?.wallet_address;
    }
    
    // Use direct payment if user wallet available (competitive model)
    if (userWalletAddress) {
      const { processDirectPayment } = await import('./economics/directPayment');
      const paymentPerNode = cost / nodeIds.length;
      
      for (const nodeId of nodeIds) {
        const nodeResult = await client.query(
          'SELECT wallet_address FROM nodes WHERE id = $1',
          [nodeId]
        );
        
        if (nodeResult.rows.length > 0 && nodeResult.rows[0].wallet_address) {
          try {
            await processDirectPayment(
              taskId,
              taskUserId || '',
              nodeId,
              paymentPerNode,
              userWalletAddress,
              nodeResult.rows[0].wallet_address
            );
          } catch (error: any) {
            logger.warn('Direct payment failed, falling back to traditional', {
              error: error.message,
              nodeId,
            });
            // Fallback to traditional payment
            await processPayment({
              user_id: taskUserId || '',
              amount: paymentPerNode,
              node_id: nodeId,
              task_id: taskId,
              transaction_type: 'payout',
            });
          }
        }
      }
    } else {
      // Traditional payment (fallback)
      const paymentPerNode = cost / nodeIds.length;
      
      for (const nodeId of nodeIds) {
        await processPayment({
          user_id: taskUserId || '',
          amount: paymentPerNode,
          node_id: nodeId,
          task_id: taskId,
          transaction_type: 'payout',
        });
      }
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Process daily payouts to node wallets (with GXA Coin)
 */
export async function processDailyPayouts(): Promise<void> {
  const client = await pool.connect();
  
  try {
    // Get all nodes with earnings
    const nodesResult = await client.query(
      `SELECT id, wallet_address, total_earnings 
       FROM nodes 
       WHERE total_earnings > 0 
       AND status != 'blocked'`
    );
    
    for (const node of nodesResult.rows) {
      const earnings = parseFloat(node.total_earnings);
      const walletAddress = node.wallet_address;
      
      if (walletAddress && earnings > 0) {
        try {
          // In production, this would trigger a GXA Coin transfer
          // For now, we log it
          logger.info('Processing GXA payout', {
            nodeId: node.id,
            wallet: walletAddress,
            amount: earnings,
          });
          
          // Reset earnings (in production, only after confirmed blockchain tx)
          // await client.query(
          //   'UPDATE nodes SET total_earnings = 0 WHERE id = $1',
          //   [node.id]
          // );
        } catch (error: any) {
          logger.error('GXA payout failed', {
            nodeId: node.id,
            error: error.message,
          });
        }
      }
    }
  } finally {
    client.release();
  }
}
