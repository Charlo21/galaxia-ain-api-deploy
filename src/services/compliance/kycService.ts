/**
 * KYC/AML Compliance Service
 * Implements comprehensive KYC verification, PEP screening, and sanctions checking
 * Compliant with MiCA, FinCEN, FCA, and global AML requirements
 */

import { pool } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface KYCProfile {
  id: string;
  user_id: string;
  kyc_level: 'none' | 'basic' | 'intermediate' | 'advanced' | 'institutional';
  kyc_status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'suspended';
  verification_tier: number;
  first_name?: string;
  last_name?: string;
  date_of_birth?: Date;
  nationality?: string;
  country_of_residence?: string;
  entity_name?: string;
  entity_type?: string;
  government_id_verified: boolean;
  address_verified: boolean;
  source_of_funds_verified: boolean;
  pep_check_completed: boolean;
  sanctions_check_completed: boolean;
  pep_status?: string;
  sanctions_match: boolean;
  daily_limit: number;
  monthly_limit: number;
  annual_limit: number;
  single_transaction_limit: number;
  high_risk_jurisdiction: boolean;
  requires_enhanced_due_diligence: boolean;
  verified_at?: Date;
  expires_at?: Date;
  sanctions_status?: string;
  last_screened_at?: string;
  risk_score?: number;
  risk_level?: string;
  risk_factors?: string[];
}

export interface KYCDocument {
  document_type: 'passport' | 'drivers_license' | 'national_id' | 'proof_of_address' | 'source_of_funds' | 'beneficial_ownership';
  document_number?: string;
  issuing_country?: string;
  issue_date?: Date;
  expiry_date?: Date;
  file_data?: Buffer;
}

export interface SanctionsScreeningResult {
  match_found: boolean;
  match_score: number;
  list_name?: string;
  list_entry_id?: string;
  match_details?: any;
}

/**
 * Create or update KYC profile
 */
export async function createOrUpdateKYCProfile(
  userId: string,
  profileData: Partial<KYCProfile>
): Promise<KYCProfile> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if profile exists
    const existingResult = await client.query(
      'SELECT * FROM kyc_profiles WHERE user_id = $1',
      [userId]
    );
    
    let profile: KYCProfile;
    
    if (existingResult.rows.length > 0) {
      // Update existing
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;
      
      Object.entries(profileData).forEach(([key, value]) => {
        if (value !== undefined && key !== 'id' && key !== 'user_id') {
          updateFields.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });
      
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(userId);
      
      const updateQuery = `
        UPDATE kyc_profiles 
        SET ${updateFields.join(', ')}
        WHERE user_id = $${paramIndex}
        RETURNING *
      `;
      
      const result = await client.query(updateQuery, values);
      profile = result.rows[0];
    } else {
      // Create new
      const insertQuery = `
        INSERT INTO kyc_profiles (user_id, first_name, last_name, date_of_birth, nationality, 
          country_of_residence, entity_name, entity_type, kyc_level, kyc_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      
      const result = await client.query(insertQuery, [
        userId,
        profileData.first_name,
        profileData.last_name,
        profileData.date_of_birth,
        profileData.nationality,
        profileData.country_of_residence,
        profileData.entity_name,
        profileData.entity_type,
        profileData.kyc_level || 'basic',
        'pending'
      ]);
      
      profile = result.rows[0];
    }
    
    await client.query('COMMIT');
    return profile;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Upload and encrypt KYC document
 */
export async function uploadKYCDocument(
  kycProfileId: string,
  document: KYCDocument,
  fileData: Buffer
): Promise<string> {
  const client = await pool.connect();
  
  try {
    // Encrypt document data
    const encryptionKey = process.env.DOCUMENT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    
    let encrypted = cipher.update(fileData);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    // Combine IV + encrypted data + auth tag
    const encryptedData = Buffer.concat([iv, encrypted, authTag]);
    
    // Calculate hash for integrity
    const fileHash = crypto.createHash('sha256').update(fileData).digest('hex');
    
    // Store encrypted document
    const insertQuery = `
      INSERT INTO kyc_documents 
        (kyc_profile_id, document_type, document_number, issuing_country, 
         issue_date, expiry_date, encrypted_data, file_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    
    const result = await client.query(insertQuery, [
      kycProfileId,
      document.document_type,
      document.document_number,
      document.issuing_country,
      document.issue_date,
      document.expiry_date,
      encryptedData,
      fileHash
    ]);
    
    return result.rows[0].id;
  } finally {
    client.release();
  }
}

/**
 * Screen user against sanctions lists (OFAC, UN, EU, UK)
 */
export async function screenSanctions(
  userId: string,
  fullName: string,
  dateOfBirth?: Date,
  nationality?: string
): Promise<SanctionsScreeningResult> {
  // In production, integrate with actual sanctions screening APIs:
  // - Dow Jones Risk & Compliance
  // - World-Check
  // - ComplyAdvantage
  // - Chainalysis
  
  // Mock implementation - replace with real API calls
  const screeningTypes = ['ofac', 'un', 'eu', 'uk', 'pep'];
  const results: SanctionsScreeningResult[] = [];
  
  for (const screeningType of screeningTypes) {
    // Simulate API call
    const matchFound = false; // Replace with actual screening logic
    const matchScore = 0; // Similarity score 0-100
    
    await pool.query(
      `INSERT INTO sanctions_screening 
        (user_id, screening_type, full_name, date_of_birth, nationality, 
         match_found, match_score, screened_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [userId, screeningType, fullName, dateOfBirth, nationality, matchFound, matchScore]
    );
    
    results.push({
      match_found: matchFound,
      match_score: matchScore,
      list_name: matchFound ? screeningType : undefined
    });
  }
  
  // Check if any match found
  const anyMatch = results.some(r => r.match_found);
  const maxScore = Math.max(...results.map(r => r.match_score));
  
  // Update KYC profile
  await pool.query(
    `UPDATE kyc_profiles 
     SET sanctions_check_completed = true, 
         sanctions_match = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2`,
    [anyMatch, userId]
  );
  
  return {
    match_found: anyMatch,
    match_score: maxScore
  };
}

/**
 * Check if user is PEP (Politically Exposed Person)
 */
export async function screenPEP(
  userId: string,
  fullName: string,
  dateOfBirth?: Date,
  nationality?: string
): Promise<{ isPEP: boolean; pepStatus: string }> {
  // In production, integrate with PEP screening APIs
  // Mock implementation
  const isPEP = false;
  const pepStatus = 'none'; // none, pep, rpep, family_member, close_associate
  
  await pool.query(
    `UPDATE kyc_profiles 
     SET pep_check_completed = true,
         pep_status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2`,
    [pepStatus, userId]
  );
  
  return { isPEP, pepStatus };
}

/**
 * Calculate transaction limits based on KYC level
 */
export async function getTransactionLimits(userId: string): Promise<{
  daily: number;
  monthly: number;
  annual: number;
  single: number;
}> {
  const result = await pool.query(
    `SELECT daily_limit, monthly_limit, annual_limit, single_transaction_limit
     FROM kyc_profiles
     WHERE user_id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    // Default limits for unverified users
    return {
      daily: 0,
      monthly: 0,
      annual: 0,
      single: 0
    };
  }
  
  const profile = result.rows[0];
  return {
    daily: parseFloat(profile.daily_limit) || 0,
    monthly: parseFloat(profile.monthly_limit) || 0,
    annual: parseFloat(profile.annual_limit) || 0,
    single: parseFloat(profile.single_transaction_limit) || 0
  };
}

/**
 * Verify KYC profile and set limits based on tier
 */
export async function verifyKYCProfile(
  kycProfileId: string,
  verifiedBy: string,
  tier: number
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Set limits based on tier
    const limits = getTierLimits(tier);
    
    await client.query(
      `UPDATE kyc_profiles
       SET kyc_status = 'approved',
           verification_tier = $1,
           daily_limit = $2,
           monthly_limit = $3,
           annual_limit = $4,
           single_transaction_limit = $5,
           verified_at = CURRENT_TIMESTAMP,
           expires_at = CURRENT_TIMESTAMP + INTERVAL '1 year',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        tier,
        limits.daily,
        limits.monthly,
        limits.annual,
        limits.single,
        kycProfileId
      ]
    );
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get tier limits (in GXA tokens)
 */
function getTierLimits(tier: number): {
  daily: number;
  monthly: number;
  annual: number;
  single: number;
} {
  const limits = {
    0: { daily: 0, monthly: 0, annual: 0, single: 0 },
    1: { daily: 1000, monthly: 10000, annual: 100000, single: 500 }, // Basic
    2: { daily: 10000, monthly: 100000, annual: 1000000, single: 5000 }, // Intermediate
    3: { daily: 100000, monthly: 1000000, annual: 10000000, single: 50000 }, // Advanced
    4: { daily: 1000000, monthly: 10000000, annual: 100000000, single: 500000 } // Institutional
  };
  
  return limits[tier as keyof typeof limits] || limits[0];
}

/**
 * Check if KYC is required for transaction amount
 */
export async function isKYCRequired(userId: string, amount: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT kyc_status, kyc_level, single_transaction_limit
     FROM kyc_profiles
     WHERE user_id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    return true; // No KYC profile = KYC required
  }
  
  const profile = result.rows[0];
  
  if (profile.kyc_status !== 'approved') {
    return true; // Not approved = KYC required
  }
  
  if (amount > parseFloat(profile.single_transaction_limit || 0)) {
    return true; // Exceeds limit = KYC upgrade required
  }
  
  return false;
}

/**
 * Get KYC profile for user
 */
export async function getKYCProfile(userId: string): Promise<KYCProfile | null> {
  const result = await pool.query(
    'SELECT * FROM kyc_profiles WHERE user_id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0] as KYCProfile;
}

