/**
 * Enhanced Token Economics for GXA Coin
 * Optimized utility for competitive positioning
 */

import { pool } from '../config/database';
import { logger } from '../index';

export interface TokenUtility {
  providerCompensation: number;
  networkResourceAllocation: number;
  governanceParticipation: number;
  userAccessRights: number;
}

/**
 * Calculate token utility score for a node
 * Higher score = better economic incentives
 */
export async function calculateTokenUtility(nodeId: string): Promise<TokenUtility> {
  const client = await pool.connect();
  
  try {
    const nodeResult = await client.query(
      `SELECT 
        total_earnings,
        tasks_completed,
        reputation,
        status
       FROM nodes
       WHERE id = $1`,
      [nodeId]
    );
    
    if (nodeResult.rows.length === 0) {
      throw new Error('Node not found');
    }
    
    const node = nodeResult.rows[0];
    const earnings = parseFloat(node.total_earnings) || 0;
    const tasksCompleted = node.tasks_completed || 0;
    const reputation = parseFloat(node.reputation) || 0;
    
    // Provider compensation score (based on earnings)
    const providerCompensation = Math.min(100, (earnings / 1000) * 100); // Scale to 100
    
    // Network resource allocation (based on tasks completed)
    const networkResourceAllocation = Math.min(100, (tasksCompleted / 100) * 100);
    
    // Governance participation (based on reputation)
    const governanceParticipation = reputation;
    
    // User access rights (based on reputation and status)
    const userAccessRights = node.status === 'online' ? reputation : 0;
    
    return {
      providerCompensation,
      networkResourceAllocation,
      governanceParticipation,
      userAccessRights,
    };
  } finally {
    client.release();
  }
}

/**
 * Get token economics metrics
 */
export async function getTokenEconomicsMetrics(): Promise<{
  totalGXACirculating: number;
  totalPaidToProviders: number;
  avgProviderEarnings: number;
  governanceParticipation: number;
  networkEfficiency: number;
}> {
  const client = await pool.connect();
  
  try {
    // Get total paid to providers
    const paymentsResult = await client.query(`
      SELECT 
        SUM(amount) as total_paid,
        COUNT(DISTINCT node_id) as provider_count
      FROM direct_payments
      WHERE status = 'confirmed'
    `);
    
    // Get average provider earnings
    const earningsResult = await client.query(`
      SELECT AVG(total_earnings) as avg_earnings
      FROM nodes
      WHERE total_earnings > 0
    `);
    
    // Get governance participation (nodes with high reputation)
    const governanceResult = await client.query(`
      SELECT COUNT(*) as governance_participants
      FROM nodes
      WHERE reputation >= 70 AND status = 'online'
    `);
    
    // Calculate network efficiency (direct payments vs platform fees)
    const efficiencyResult = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE platform_fee_percent = 0) as direct_payments,
        COUNT(*) as total_payments
      FROM tasks
      WHERE status = 'completed'
    `);
    
    const totalPaid = parseFloat(paymentsResult.rows[0]?.total_paid) || 0;
    const providerCount = parseInt(paymentsResult.rows[0]?.provider_count) || 0;
    const avgEarnings = parseFloat(earningsResult.rows[0]?.avg_earnings) || 0;
    const governanceParticipants = parseInt(governanceResult.rows[0]?.governance_participants) || 0;
    
    const directPayments = parseInt(efficiencyResult.rows[0]?.direct_payments) || 0;
    const totalPayments = parseInt(efficiencyResult.rows[0]?.total_payments) || 0;
    const networkEfficiency = totalPayments > 0 ? (directPayments / totalPayments) * 100 : 0;
    
    return {
      totalGXACirculating: totalPaid, // Simplified - would query blockchain in production
      totalPaidToProviders: totalPaid,
      avgProviderEarnings: avgEarnings,
      governanceParticipation: governanceParticipants,
      networkEfficiency,
    };
  } finally {
    client.release();
  }
}

/**
 * Calculate optimal provider compensation
 * Ensures competitive rates vs centralized providers
 */
export function calculateOptimalCompensation(
  baseCost: number,
  nodeReputation: number,
  taskComplexity: number
): number {
  // Base compensation
  let compensation = baseCost;
  
  // Reputation bonus (up to 20% for high-reputation nodes)
  const reputationBonus = (nodeReputation / 100) * 0.2;
  
  // Complexity multiplier
  const complexityMultiplier = 1 + (taskComplexity * 0.1);
  
  // Final compensation (no platform fee)
  compensation = compensation * (1 + reputationBonus) * complexityMultiplier;
  
  return compensation;
}

/**
 * Get competitive positioning metrics
 */
export async function getCompetitiveMetrics(): Promise<{
  costSavingsVsAWS: number; // Percentage
  privacyScore: number; // 0-100
  decentralizationScore: number; // 0-100
  providerEarningsRatio: number; // % of payment going to providers
}> {
  const client = await pool.connect();
  
  try {
    // Calculate cost savings (assuming AWS charges 2x our rates)
    const costResult = await client.query(`
      SELECT AVG(cost_tokens) as avg_cost
      FROM tasks
      WHERE status = 'completed'
    `);
    
    const avgCost = parseFloat(costResult.rows[0]?.avg_cost) || 0;
    const awsEquivalent = avgCost * 2; // AWS typically 2x more expensive
    const costSavings = awsEquivalent > 0 ? ((awsEquivalent - avgCost) / awsEquivalent) * 100 : 0;
    
    // Privacy score (based on privacy-enabled tasks)
    const privacyResult = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE privacy_level != 'public') as private_tasks,
        COUNT(*) as total_tasks
      FROM tasks
      WHERE status = 'completed'
    `);
    
    const privateTasks = parseInt(privacyResult.rows[0]?.private_tasks) || 0;
    const totalTasks = parseInt(privacyResult.rows[0]?.total_tasks) || 0;
    const privacyScore = totalTasks > 0 ? (privateTasks / totalTasks) * 100 : 0;
    
    // Decentralization score (based on node distribution)
    const decentralizationResult = await client.query(`
      SELECT 
        COUNT(DISTINCT location->>'country') as countries,
        COUNT(*) as total_nodes
      FROM nodes
      WHERE status = 'online'
    `);
    
    const countries = parseInt(decentralizationResult.rows[0]?.countries) || 0;
    const totalNodes = parseInt(decentralizationResult.rows[0]?.total_nodes) || 0;
    const decentralizationScore = Math.min(100, (countries / 10) * 100 + (totalNodes / 50) * 100);
    
    // Provider earnings ratio (should be 100% for direct payments)
    const earningsResult = await client.query(`
      SELECT 
        SUM(amount) as total_paid,
        AVG(platform_fee_percent) as avg_fee
      FROM direct_payments
      WHERE status = 'confirmed'
    `);
    
    const totalPaid = parseFloat(earningsResult.rows[0]?.total_paid) || 0;
    const avgFee = parseFloat(earningsResult.rows[0]?.avg_fee) || 0;
    const providerEarningsRatio = 100 - avgFee; // 100% = all goes to providers
    
    return {
      costSavingsVsAWS: costSavings,
      privacyScore,
      decentralizationScore,
      providerEarningsRatio,
    };
  } finally {
    client.release();
  }
}

