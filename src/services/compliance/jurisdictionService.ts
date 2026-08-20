/**
 * Jurisdiction Detection & Geo-Blocking Service
 * Implements IP-based geolocation, jurisdiction detection, and geo-blocking
 * Compliant with licensing requirements across jurisdictions
 */

import { pool } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface UserJurisdiction {
  id: string;
  user_id: string;
  ip_address?: string;
  detected_country: string;
  detected_region?: string;
  detected_city?: string;
  declared_country?: string;
  jurisdiction_status: 'allowed' | 'restricted' | 'blocked' | 'requires_license';
  geo_blocked: boolean;
  license_required: boolean;
  license_held: boolean;
}

/**
 * Restricted/Blocked jurisdictions (where we don't have licenses)
 */
const RESTRICTED_JURISDICTIONS: string[] = [
  // Add jurisdictions where licenses are not held
  // Example: 'AFG', 'IRN', 'PRK', 'SYR', 'YEM' (sanctioned)
];

/**
 * Jurisdictions requiring specific licenses
 */
const LICENSE_REQUIRED_JURISDICTIONS: Record<string, string> = {
  'USA': 'money_transmitter_license',
  'GBR': 'fca_registration',
  // Add more as licenses are obtained
};

/**
 * Detect user jurisdiction from IP address
 */
export async function detectJurisdiction(
  userId: string,
  ipAddress: string
): Promise<UserJurisdiction> {
  // In production, use a geolocation service:
  // - MaxMind GeoIP2
  // - ipapi.co
  // - ip-api.com
  // - Cloudflare geolocation headers
  
  // Mock implementation - replace with actual geolocation
  const detectedCountry = await geolocateIP(ipAddress);
  
  // Check if jurisdiction is restricted
  const isRestricted = RESTRICTED_JURISDICTIONS.includes(detectedCountry);
  const requiresLicense = LICENSE_REQUIRED_JURISDICTIONS.hasOwnProperty(detectedCountry);
  const hasLicense = false; // Check against actual license database
  
  const jurisdictionStatus = isRestricted 
    ? 'blocked' 
    : (requiresLicense && !hasLicense) 
      ? 'requires_license' 
      : 'allowed';
  
  const geoBlocked = jurisdictionStatus === 'blocked' || jurisdictionStatus === 'requires_license';
  
  // Store or update jurisdiction
  const result = await pool.query(
    `INSERT INTO user_jurisdictions
       (id, user_id, ip_address, detected_country, jurisdiction_status,
        geo_blocked, license_required, license_held, last_verified_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) 
     DO UPDATE SET
       ip_address = EXCLUDED.ip_address,
       detected_country = EXCLUDED.detected_country,
       jurisdiction_status = EXCLUDED.jurisdiction_status,
       geo_blocked = EXCLUDED.geo_blocked,
       license_required = EXCLUDED.license_required,
       license_held = EXCLUDED.license_held,
       last_verified_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      uuidv4(),
      userId,
      ipAddress,
      detectedCountry,
      jurisdictionStatus,
      geoBlocked,
      requiresLicense,
      hasLicense
    ]
  );
  
  return result.rows[0] as UserJurisdiction;
}

/**
 * Mock IP geolocation - replace with actual service
 */
async function geolocateIP(ipAddress: string): Promise<string> {
  // In production, call geolocation API
  // For now, return a default
  return 'USA'; // Replace with actual geolocation
}

/**
 * Check if user is geo-blocked
 */
export async function isGeoBlocked(userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT geo_blocked FROM user_jurisdictions WHERE user_id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    return false; // Allow if jurisdiction not detected yet
  }
  
  return result.rows[0].geo_blocked === true;
}

/**
 * Get user jurisdiction
 */
export async function getUserJurisdiction(userId: string): Promise<UserJurisdiction | null> {
  const result = await pool.query(
    'SELECT * FROM user_jurisdictions WHERE user_id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0] as UserJurisdiction;
}

/**
 * Update declared jurisdiction (self-declared)
 */
export async function updateDeclaredJurisdiction(
  userId: string,
  country: string,
  region?: string
): Promise<void> {
  await pool.query(
    `UPDATE user_jurisdictions
     SET declared_country = $1,
         declared_region = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $3`,
    [country, region, userId]
  );
}

/**
 * Get compliance requirements for jurisdiction
 */
export async function getJurisdictionRequirements(
  countryCode: string
): Promise<{
  requires_kyc: boolean;
  requires_tax_reporting: boolean;
  requires_disclosures: boolean;
  travel_rule_threshold: number;
  data_retention_years: number;
  gdpr_applicable: boolean;
}> {
  const result = await pool.query(
    `SELECT * FROM compliance_config WHERE jurisdiction = $1`,
    [countryCode]
  );
  
  if (result.rows.length === 0) {
    // Default requirements
    return {
      requires_kyc: true,
      requires_tax_reporting: false,
      requires_disclosures: true,
      travel_rule_threshold: 3000,
      data_retention_years: 5,
      gdpr_applicable: false
    };
  }
  
  const config = result.rows[0];
  return {
    requires_kyc: config.kyc_required,
    requires_tax_reporting: config.annual_reporting_required,
    requires_disclosures: true,
    travel_rule_threshold: parseFloat(config.travel_rule_threshold || 3000),
    data_retention_years: config.data_retention_years || 5,
    gdpr_applicable: config.gdpr_applicable
  };
}

