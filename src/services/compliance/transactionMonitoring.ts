/**
 * Transaction Monitoring & Compliance Service
 * Real-time transaction monitoring for AML/CTF compliance
 * Implements suspicious activity detection, velocity checks, structuring detection
 */

import { pool } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface TransactionAlert {
  id: string;
  user_id: string;
  transaction_id?: string;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive' | 'escalated';
  rule_triggered: string;
  detection_score: number;
  pattern_details: any;
  created_at?: string;
}

export interface MonitoringRule {
  name: string;
  description: string;
  threshold: number;
  time_window_hours: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Monitor transaction for suspicious activity
 */
export async function monitorTransaction(
  userId: string,
  transactionId: string,
  amount: number,
  transactionType: string,
  metadata?: any
): Promise<TransactionAlert[]> {
  const alerts: TransactionAlert[] = [];
  
  // 1. Velocity check - rapid transactions
  const velocityAlert = await checkVelocity(userId, amount, transactionType);
  if (velocityAlert) {
    alerts.push(velocityAlert);
  }
  
  // 2. Structuring detection - breaking large amounts into smaller ones
  const structuringAlert = await checkStructuring(userId, amount);
  if (structuringAlert) {
    alerts.push(structuringAlert);
  }
  
  // 3. High-risk jurisdiction check
  const jurisdictionAlert = await checkHighRiskJurisdiction(userId);
  if (jurisdictionAlert) {
    alerts.push(jurisdictionAlert);
  }
  
  // 4. Unusual pattern detection
  const patternAlert = await checkUnusualPatterns(userId, amount, transactionType);
  if (patternAlert) {
    alerts.push(patternAlert);
  }
  
  // 5. Sanctions check
  const sanctionsAlert = await checkSanctionsMatch(userId);
  if (sanctionsAlert) {
    alerts.push(sanctionsAlert);
  }
  
  // 6. Large transaction check
  const largeTransactionAlert = await checkLargeTransaction(amount, userId);
  if (largeTransactionAlert) {
    alerts.push(largeTransactionAlert);
  }
  
  // Store alerts in database
  for (const alert of alerts) {
    await storeAlert(alert, transactionId);
  }
  
  return alerts;
}

/**
 * Check transaction velocity (rapid successive transactions)
 */
async function checkVelocity(
  userId: string,
  amount: number,
  transactionType: string
): Promise<TransactionAlert | null> {
  // Check transactions in last 24 hours
  const result = await pool.query(
    `SELECT COUNT(*) as count, SUM(amount) as total
     FROM token_transactions
     WHERE user_id = $1 
       AND transaction_type = $2
       AND created_at > NOW() - INTERVAL '24 hours'
       AND status = 'completed'`,
    [userId, transactionType]
  );
  
  const count = parseInt(result.rows[0].count);
  const total = parseFloat(result.rows[0].total || 0);
  
  // Alert if more than 50 transactions in 24 hours
  if (count > 50) {
    return {
      id: uuidv4(),
      user_id: userId,
      alert_type: 'velocity_check',
      severity: 'high',
      status: 'open',
      rule_triggered: 'high_velocity_transactions',
      detection_score: Math.min(100, count * 2),
      pattern_details: {
        transaction_count: count,
        time_window: '24 hours',
        total_amount: total
      }
    };
  }
  
  // Alert if total exceeds monthly limit significantly
  const monthlyResult = await pool.query(
    `SELECT SUM(amount) as total
     FROM token_transactions
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '30 days'
       AND status = 'completed'`,
    [userId]
  );
  
  const monthlyTotal = parseFloat(monthlyResult.rows[0].total || 0);
  
  // Get user's monthly limit
  const kycResult = await pool.query(
    `SELECT monthly_limit FROM kyc_profiles WHERE user_id = $1`,
    [userId]
  );
  
  if (kycResult.rows.length > 0) {
    const monthlyLimit = parseFloat(kycResult.rows[0].monthly_limit || 0);
    if (monthlyLimit > 0 && monthlyTotal > monthlyLimit * 1.5) {
      return {
        id: uuidv4(),
        user_id: userId,
        alert_type: 'limit_exceeded',
        severity: 'medium',
        status: 'open',
        rule_triggered: 'monthly_limit_exceeded',
        detection_score: 75,
        pattern_details: {
          monthly_total: monthlyTotal,
          monthly_limit: monthlyLimit,
          excess_amount: monthlyTotal - monthlyLimit
        }
      };
    }
  }
  
  return null;
}

/**
 * Check for structuring (breaking large transactions into smaller ones)
 */
async function checkStructuring(
  userId: string,
  amount: number
): Promise<TransactionAlert | null> {
  // Check for multiple transactions just below reporting threshold
  const threshold = 10000; // Example threshold
  
  if (amount >= threshold * 0.9 && amount < threshold) {
    // Check for similar transactions in short time window
    const result = await pool.query(
      `SELECT COUNT(*) as count, SUM(amount) as total
       FROM token_transactions
       WHERE user_id = $1
         AND amount >= $2 * 0.9
         AND amount < $2
         AND created_at > NOW() - INTERVAL '1 hour'
         AND status = 'completed'`,
      [userId, threshold]
    );
    
    const count = parseInt(result.rows[0].count);
    const total = parseFloat(result.rows[0].total || 0);
    
    if (count >= 3 && total >= threshold) {
      return {
        id: uuidv4(),
        user_id: userId,
        alert_type: 'structuring',
        severity: 'high',
        status: 'open',
        rule_triggered: 'potential_structuring',
        detection_score: 85,
        pattern_details: {
          transaction_count: count,
          total_amount: total,
          threshold: threshold,
          time_window: '1 hour'
        }
      };
    }
  }
  
  return null;
}

/**
 * Check if user is from high-risk jurisdiction
 */
async function checkHighRiskJurisdiction(
  userId: string
): Promise<TransactionAlert | null> {
  // High-risk jurisdictions list (FATF list, etc.)
  const highRiskCountries = [
    'AFG', 'IRN', 'PRK', 'SYR', 'YEM', // Sanctioned countries
    // Add more based on FATF high-risk jurisdictions
  ];
  
  const result = await pool.query(
    `SELECT detected_country, high_risk_jurisdiction
     FROM user_jurisdictions
     WHERE user_id = $1`,
    [userId]
  );
  
  if (result.rows.length > 0) {
    const jurisdiction = result.rows[0];
    
    if (jurisdiction.high_risk_jurisdiction || 
        highRiskCountries.includes(jurisdiction.detected_country)) {
      return {
        id: uuidv4(),
        user_id: userId,
        alert_type: 'high_risk_jurisdiction',
        severity: 'medium',
        status: 'open',
        rule_triggered: 'high_risk_jurisdiction_detected',
        detection_score: 60,
        pattern_details: {
          country: jurisdiction.detected_country,
          risk_level: 'high'
        }
      };
    }
  }
  
  return null;
}

/**
 * Check for unusual transaction patterns
 */
async function checkUnusualPatterns(
  userId: string,
  amount: number,
  transactionType: string
): Promise<TransactionAlert | null> {
  // Get user's transaction history
  const result = await pool.query(
    `SELECT AVG(amount) as avg_amount, STDDEV(amount) as stddev_amount
     FROM token_transactions
     WHERE user_id = $1
       AND transaction_type = $2
       AND created_at > NOW() - INTERVAL '90 days'
       AND status = 'completed'`,
    [userId, transactionType]
  );
  
  if (result.rows.length > 0 && result.rows[0].avg_amount) {
    const avgAmount = parseFloat(result.rows[0].avg_amount);
    const stddev = parseFloat(result.rows[0].stddev_amount || 0);
    
    // Alert if transaction is more than 3 standard deviations from mean
    if (stddev > 0 && Math.abs(amount - avgAmount) > 3 * stddev) {
      return {
        id: uuidv4(),
        user_id: userId,
        alert_type: 'unusual_pattern',
        severity: 'medium',
        status: 'open',
        rule_triggered: 'statistical_anomaly',
        detection_score: 70,
        pattern_details: {
          transaction_amount: amount,
          average_amount: avgAmount,
          standard_deviation: stddev,
          deviation: Math.abs(amount - avgAmount) / stddev
        }
      };
    }
  }
  
  return null;
}

/**
 * Check if user has sanctions match
 */
async function checkSanctionsMatch(
  userId: string
): Promise<TransactionAlert | null> {
  const result = await pool.query(
    `SELECT match_found, match_score, list_name
     FROM sanctions_screening
     WHERE user_id = $1
       AND match_found = true
       AND review_decision != 'false_positive'
     ORDER BY screened_at DESC
     LIMIT 1`,
    [userId]
  );
  
  if (result.rows.length > 0) {
    const match = result.rows[0];
    return {
      id: uuidv4(),
      user_id: userId,
      alert_type: 'sanctions_match',
      severity: 'critical',
      status: 'open',
      rule_triggered: 'sanctions_list_match',
      detection_score: 100,
      pattern_details: {
        list_name: match.list_name,
        match_score: match.match_score
      }
    };
  }
  
  return null;
}

/**
 * Check for large transaction (CTR/LTR reporting)
 */
async function checkLargeTransaction(
  amount: number,
  userId: string
): Promise<TransactionAlert | null> {
  // Get jurisdiction-specific threshold
  const jurisdictionResult = await pool.query(
    `SELECT uj.detected_country, cc.ctr_threshold, cc.ltr_threshold
     FROM user_jurisdictions uj
     LEFT JOIN compliance_config cc ON uj.detected_country = cc.jurisdiction
     WHERE uj.user_id = $1`,
    [userId]
  );
  
  if (jurisdictionResult.rows.length > 0) {
    const config = jurisdictionResult.rows[0];
    const ctrThreshold = parseFloat(config.ctr_threshold || 10000);
    const ltrThreshold = parseFloat(config.ltr_threshold || 100000);
    
    if (amount >= ltrThreshold) {
      return {
        id: uuidv4(),
        user_id: userId,
        alert_type: 'large_transaction',
        severity: 'high',
        status: 'open',
        rule_triggered: 'ltr_threshold_exceeded',
        detection_score: 90,
        pattern_details: {
          transaction_amount: amount,
          threshold: ltrThreshold,
          report_type: 'LTR'
        }
      };
    } else if (amount >= ctrThreshold) {
      return {
        id: uuidv4(),
        user_id: userId,
        alert_type: 'large_transaction',
        severity: 'medium',
        status: 'open',
        rule_triggered: 'ctr_threshold_exceeded',
        detection_score: 70,
        pattern_details: {
          transaction_amount: amount,
          threshold: ctrThreshold,
          report_type: 'CTR'
        }
      };
    }
  }
  
  return null;
}

/**
 * Store alert in database
 */
async function storeAlert(
  alert: TransactionAlert,
  transactionId?: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO transaction_alerts
       (id, user_id, transaction_id, alert_type, severity, status,
        rule_triggered, detection_score, pattern_details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      alert.id,
      alert.user_id,
      transactionId || null,
      alert.alert_type,
      alert.severity,
      alert.status,
      alert.rule_triggered,
      alert.detection_score,
      JSON.stringify(alert.pattern_details)
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Get alerts for user
 */
export async function getUserAlerts(
  userId: string,
  status?: string
): Promise<TransactionAlert[]> {
  let query = `
    SELECT * FROM transaction_alerts
    WHERE user_id = $1
  `;
  const params: any[] = [userId];
  
  if (status) {
    query += ' AND status = $2';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT 100';
  
  const result = await pool.query(query, params);
  return result.rows.map(row => ({
    ...row,
    pattern_details: typeof row.pattern_details === 'string' 
      ? JSON.parse(row.pattern_details) 
      : row.pattern_details
  }));
}

