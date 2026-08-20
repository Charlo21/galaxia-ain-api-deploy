/**
 * Legal Documents Service
 * Manages Terms of Service, Privacy Policy, Risk Disclosures, and user consent
 */

import { pool } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface LegalDocument {
  id: string;
  document_type: string;
  version: string;
  jurisdiction?: string;
  title: string;
  content: string;
  summary?: string;
  effective_date: Date;
  expiry_date?: Date;
  mandatory: boolean;
  requires_reacceptance: boolean;
  is_active: boolean;
  is_current: boolean;
}

/**
 * Get current legal document for user's jurisdiction
 */
export async function getCurrentDocument(
  documentType: string,
  jurisdiction?: string
): Promise<LegalDocument | null> {
  let query = `
    SELECT * FROM legal_documents
    WHERE document_type = $1
      AND is_active = true
      AND is_current = true
  `;
  const params: any[] = [documentType];
  
  if (jurisdiction) {
    query += ' AND (jurisdiction = $2 OR jurisdiction IS NULL)';
    params.push(jurisdiction);
  } else {
    query += ' AND jurisdiction IS NULL';
  }
  
  query += ' ORDER BY jurisdiction NULLS LAST LIMIT 1';
  
  const result = await pool.query(query, params);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0] as LegalDocument;
}

/**
 * Check if user has consented to document
 */
export async function hasUserConsented(
  userId: string,
  documentId: string,
  documentVersion: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM user_consents
     WHERE user_id = $1
       AND document_id = $2
       AND document_version = $3
       AND consented = true`,
    [userId, documentId, documentVersion]
  );
  
  return parseInt(result.rows[0].count) > 0;
}

/**
 * Record user consent
 */
export async function recordConsent(
  userId: string,
  documentId: string,
  documentVersion: string,
  consented: boolean,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO user_consents
       (id, user_id, document_id, consented, consent_method,
        ip_address, user_agent, document_version, consented_at)
     VALUES
       (uuid_generate_v4(), $1, $2, $3, 'web_ui', $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, document_id, document_version)
     DO UPDATE SET
       consented = EXCLUDED.consented,
       consented_at = CURRENT_TIMESTAMP`,
    [userId, documentId, consented, ipAddress || null, userAgent || null, documentVersion]
  );
}

/**
 * Get all required documents for user
 */
export async function getRequiredDocuments(
  userId: string,
  jurisdiction?: string
): Promise<Array<LegalDocument & { consented: boolean }>> {
  // Get user's jurisdiction if not provided
  if (!jurisdiction) {
    const jurisdictionResult = await pool.query(
      'SELECT detected_country FROM user_jurisdictions WHERE user_id = $1',
      [userId]
    );
    if (jurisdictionResult.rows.length > 0) {
      jurisdiction = jurisdictionResult.rows[0].detected_country;
    }
  }
  
  // Get all mandatory documents
  const documentsResult = await pool.query(
    `SELECT * FROM legal_documents
     WHERE mandatory = true
       AND is_active = true
       AND is_current = true
       AND (jurisdiction = $1 OR jurisdiction IS NULL)
     ORDER BY document_type`,
    [jurisdiction || null]
  );
  
  const documents = documentsResult.rows as LegalDocument[];
  
  // Check consent status for each
  const documentsWithConsent = await Promise.all(
    documents.map(async (doc) => {
      const consented = await hasUserConsented(userId, doc.id, doc.version);
      return { ...doc, consented };
    })
  );
  
  return documentsWithConsent;
}

/**
 * Create or update legal document
 */
export async function createLegalDocument(
  documentData: {
    document_type: string;
    version: string;
    jurisdiction?: string;
    title: string;
    content: string;
    summary?: string;
    effective_date: Date;
    expiry_date?: Date;
    mandatory?: boolean;
    requires_reacceptance?: boolean;
  }
): Promise<LegalDocument> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // If this is marked as current, unset other current versions
    if (documentData.requires_reacceptance !== false) {
      await client.query(
        `UPDATE legal_documents
         SET is_current = false
         WHERE document_type = $1
           AND (jurisdiction = $2 OR (jurisdiction IS NULL AND $2 IS NULL))
           AND is_current = true`,
        [documentData.document_type, documentData.jurisdiction || null]
      );
    }
    
    // Insert new document
    const result = await client.query(
      `INSERT INTO legal_documents
         (id, document_type, version, jurisdiction, title, content, summary,
          effective_date, expiry_date, mandatory, requires_reacceptance,
          is_active, is_current, created_at)
       VALUES
         (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, true, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        documentData.document_type,
        documentData.version,
        documentData.jurisdiction || null,
        documentData.title,
        documentData.content,
        documentData.summary || null,
        documentData.effective_date,
        documentData.expiry_date || null,
        documentData.mandatory !== false,
        documentData.requires_reacceptance !== false
      ]
    );
    
    await client.query('COMMIT');
    return result.rows[0] as LegalDocument;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

