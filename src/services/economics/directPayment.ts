/**
 * Direct Provider-to-Consumer Payment System
 * Eliminates intermediary costs - users pay nodes directly
 * Competitive with Cocoon's direct model
 */

import { pool } from '../../config/database';
import { gxaCoinService } from '../galaxia/gxaCoin';
import { logger } from '../../index';
import { v4 as uuidv4 } from 'uuid';

export interface DirectPayment {
  taskId: string;
  userId: string;
  nodeId: string;
  amount: number;
  userWallet: string;
  nodeWallet: string;
  txHash?: string;
  status: 'pending' | 'confirmed' | 'failed';
}

/**
 * Direct payment from user to node (no platform fees)
 * Matches Cocoon's disintermediated model
 */
export async function processDirectPayment(
  taskId: string,
  userId: string,
  nodeId: string,
  amount: number,
  userWallet: string,
  nodeWallet: string
): Promise<DirectPayment> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verify user has sufficient balance
    const userBalance = await gxaCoinService.getBalance(userWallet);
    if (parseFloat(userBalance.available) < amount) {
      throw new Error('Insufficient GXA balance');
    }
    
    // Create direct payment record
    const paymentId = uuidv4();
    await client.query(
      `INSERT INTO direct_payments 
       (id, task_id, user_id, node_id, amount, user_wallet, node_wallet, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [paymentId, taskId, userId, nodeId, amount, userWallet, nodeWallet]
    );
    
    // Execute direct GXA transfer (user -> node)
    try {
      // In production, this would be a smart contract call or direct blockchain transfer
      // For now, we simulate the transfer
      const transferResult = await gxaCoinService.transfer(
        userWallet,
        nodeWallet,
        amount.toString(),
        '', // Signature would be provided by user
      );
      
      // Update payment with transaction hash
      await client.query(
        `UPDATE direct_payments 
         SET tx_hash = $1, status = 'confirmed'
         WHERE id = $2`,
        [transferResult.txHash, paymentId]
      );
      
      // Update node earnings (for tracking)
      await client.query(
        `UPDATE nodes 
         SET total_earnings = total_earnings + $1
         WHERE id = $2`,
        [amount, nodeId]
      );
      
      await client.query('COMMIT');
      
      return {
        taskId,
        userId,
        nodeId,
        amount,
        userWallet,
        nodeWallet,
        txHash: transferResult.txHash,
        status: 'confirmed',
      };
    } catch (error: any) {
      // Mark payment as failed
      await client.query(
        `UPDATE direct_payments SET status = 'failed' WHERE id = $1`,
        [paymentId]
      );
      await client.query('COMMIT');
      throw error;
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Calculate direct payment amount (no platform fees)
 * 100% of payment goes to node operator
 */
export function calculateDirectPayment(
  baseCost: number,
  platformFeePercent: number = 0 // Zero platform fee for competitive positioning
): number {
  // All payment goes to node (no intermediary)
  return baseCost * (1 - platformFeePercent / 100);
}

/**
 * Get payment efficiency metrics
 */
export async function getPaymentEfficiency(): Promise<{
  totalPayments: number;
  directPayments: number;
  platformFeeSaved: number;
  avgNodeEarnings: number;
}> {
  const client = await pool.connect();
  
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as total_payments,
        COUNT(*) FILTER (WHERE status = 'confirmed') as direct_payments,
        SUM(amount) FILTER (WHERE status = 'confirmed') as total_direct_amount
      FROM direct_payments
    `);
    
    const nodeEarnings = await client.query(`
      SELECT AVG(total_earnings) as avg_earnings
      FROM nodes
      WHERE total_earnings > 0
    `);
    
    // Calculate platform fee saved (assuming 2.5% would have been taken)
    const totalDirect = parseFloat(result.rows[0].total_direct_amount) || 0;
    const feeSaved = totalDirect * 0.025; // 2.5% platform fee avoided
    
    return {
      totalPayments: parseInt(result.rows[0].total_payments),
      directPayments: parseInt(result.rows[0].direct_payments),
      platformFeeSaved: feeSaved,
      avgNodeEarnings: parseFloat(nodeEarnings.rows[0]?.avg_earnings) || 0,
    };
  } finally {
    client.release();
  }
}

