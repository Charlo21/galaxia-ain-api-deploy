/**
 * Travel Rule Compliance Service
 * Implements FinCEN Travel Rule, MiCA Travel Rule, and UK Travel Rule
 * Collects and transmits originator/beneficiary information for VASP-to-VASP transfers
 */

import { pool } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface TravelRuleData {
  // Originator Information
  originator_name: string;
  originator_account_number: string;
  originator_address?: string;
  originator_dob?: Date;
  originator_identification_type?: string;
  originator_identification_number?: string;
  originator_country: string;
  
  // Beneficiary Information
  beneficiary_name: string;
  beneficiary_account_number: string;
  beneficiary_address?: string;
  beneficiary_country: string;
  
  // Transaction Details
  transaction_amount: number;
  transaction_currency: string;
  transaction_date: Date;
  
  // VASP Information
  originator_vasp_name?: string;
  originator_vasp_identifier?: string;
  beneficiary_vasp_name?: string;
  beneficiary_vasp_identifier?: string;
}

/**
 * Check if Travel Rule applies to transaction
 */
export async function isTravelRuleRequired(
  amount: number,
  userId: string
): Promise<{ required: boolean; threshold: number; jurisdiction: string }> {
  // Get user's jurisdiction
  const jurisdictionResult = await pool.query(
    `SELECT uj.detected_country, cc.travel_rule_threshold
     FROM user_jurisdictions uj
     LEFT JOIN compliance_config cc ON uj.detected_country = cc.jurisdiction
     WHERE uj.user_id = $1`,
    [userId]
  );
  
  if (jurisdictionResult.rows.length === 0) {
    // Default to US threshold if jurisdiction unknown
    return {
      required: amount >= 3000,
      threshold: 3000,
      jurisdiction: 'USA'
    };
  }
  
  const config = jurisdictionResult.rows[0];
  const threshold = parseFloat(config.travel_rule_threshold || 3000);
  const jurisdiction = config.detected_country || 'USA';
  
  return {
    required: amount >= threshold,
    threshold,
    jurisdiction
  };
}

/**
 * Create Travel Rule record for transaction
 */
export async function createTravelRuleRecord(
  transactionId: string,
  travelRuleData: TravelRuleData
): Promise<string> {
  const travelRuleCheck = await isTravelRuleRequired(
    travelRuleData.transaction_amount,
    travelRuleData.originator_country as any
  );
  
  const result = await pool.query(
    `INSERT INTO travel_rule_records
       (id, transaction_id, originator_name, originator_account_number,
        originator_address, originator_dob, originator_identification_type,
        originator_identification_number, originator_country,
        beneficiary_name, beneficiary_account_number, beneficiary_address,
        beneficiary_country, transaction_amount, transaction_currency,
        transaction_date, originator_vasp_name, originator_vasp_identifier,
        beneficiary_vasp_name, beneficiary_vasp_identifier,
        threshold_exceeded, threshold_amount, jurisdiction,
        retention_until, created_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, CURRENT_TIMESTAMP)
     RETURNING id`,
    [
      uuidv4(),
      transactionId,
      travelRuleData.originator_name,
      travelRuleData.originator_account_number,
      travelRuleData.originator_address,
      travelRuleData.originator_dob,
      travelRuleData.originator_identification_type,
      travelRuleData.originator_identification_number,
      travelRuleData.originator_country,
      travelRuleData.beneficiary_name,
      travelRuleData.beneficiary_account_number,
      travelRuleData.beneficiary_address,
      travelRuleData.beneficiary_country,
      travelRuleData.transaction_amount,
      travelRuleData.transaction_currency,
      travelRuleData.transaction_date,
      travelRuleData.originator_vasp_name,
      travelRuleData.originator_vasp_identifier,
      travelRuleData.beneficiary_vasp_name,
      travelRuleData.beneficiary_vasp_identifier,
      travelRuleCheck.required,
      travelRuleCheck.threshold,
      travelRuleCheck.jurisdiction,
      new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000) // 5 years retention
    ]
  );
  
  return result.rows[0].id;
}

/**
 * Transmit Travel Rule data to beneficiary VASP
 */
export async function transmitTravelRuleData(
  travelRuleRecordId: string,
  transmissionMethod: 'api' | 'email' | 'blockchain' = 'api'
): Promise<void> {
  // Get Travel Rule record
  const result = await pool.query(
    'SELECT * FROM travel_rule_records WHERE id = $1',
    [travelRuleRecordId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Travel Rule record not found');
  }
  
  const record = result.rows[0];
  
  // In production, implement actual VASP-to-VASP communication:
  // - TRISA protocol
  // - IVMS 101 standard
  // - OpenVASP
  // - Direct API integration
  
  // Mock transmission
  const transmissionData = {
    originator: {
      name: record.originator_name,
      account: record.originator_account_number,
      address: record.originator_address,
      country: record.originator_country
    },
    beneficiary: {
      name: record.beneficiary_name,
      account: record.beneficiary_account_number,
      address: record.beneficiary_address,
      country: record.beneficiary_country
    },
    transaction: {
      amount: record.transaction_amount,
      currency: record.transaction_currency,
      date: record.transaction_date
    }
  };
  
  // Update record with transmission details
  await pool.query(
    `UPDATE travel_rule_records
     SET transmitted_to_vasp = true,
         transmission_method = $1,
         transmission_timestamp = CURRENT_TIMESTAMP,
         transmission_reference = $2
     WHERE id = $3`,
    [
      transmissionMethod,
      `TR-${Date.now()}-${travelRuleRecordId.substring(0, 8)}`,
      travelRuleRecordId
    ]
  );
  
  // Log transmission
  console.log(`Travel Rule data transmitted: ${JSON.stringify(transmissionData)}`);
}

/**
 * Get Travel Rule record for transaction
 */
export async function getTravelRuleRecord(
  transactionId: string
): Promise<any> {
  const result = await pool.query(
    'SELECT * FROM travel_rule_records WHERE transaction_id = $1',
    [transactionId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0];
}

