/**
 * Galaxia Audit Service
 * Core service for smart contract auditing operations
 */

import { pool } from '../../config/database';
import { logger } from '../../index';
import { v4 as uuidv4 } from 'uuid';
import { quantumSecurityService } from '../galaxia/quantumSecurity';
import { AuditRequest, AuditStatus, AuditFinding, AuditReport } from '../galaxia/integrations/auditClient';

export interface AuditRequestInput {
  contractAddress?: string;
  contractCode: string;
  blockchain: string;
  auditType: string;
  priority?: string;
  requestedBy: string;
  complianceRequirements?: string[];
  metadata?: Record<string, any>;
}

export class AuditService {
  /**
   * Create a new audit request
   */
  async createAuditRequest(input: AuditRequestInput): Promise<{ auditId: string; status: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const auditId = uuidv4();
      const status = 'pending';

      await client.query(
        `INSERT INTO audit_requests (
          audit_id, contract_address, contract_code, blockchain, audit_type,
          priority, requesting_app, compliance_requirements, status, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          auditId,
          input.contractAddress || null,
          input.contractCode,
          input.blockchain,
          input.auditType,
          input.priority || 'standard',
          input.requestedBy,
          input.complianceRequirements || [],
          status,
          JSON.stringify(input.metadata || {})
        ]
      );

      await client.query('COMMIT');

      // Emit event for async processing
      // In production, this would publish to Kafka/RabbitMQ
      this.emitAuditRequested(auditId, input);

      return { auditId, status };
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Create audit request failed', { error: error.message, input });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get audit status
   */
  async getAuditStatus(auditId: string): Promise<AuditStatus | null> {
    try {
      const result = await pool.query(
        `SELECT 
          ar.audit_id, ar.status, ar.created_at, ar.completed_at,
          COUNT(af.finding_id) as findings_count,
          MAX(CASE WHEN af.severity = 'critical' THEN 1 ELSE 0 END) as has_critical,
          MAX(CASE WHEN af.severity = 'high' THEN 1 ELSE 0 END) as has_high
        FROM audit_requests ar
        LEFT JOIN audit_findings af ON ar.audit_id = af.audit_id
        WHERE ar.audit_id = $1
        GROUP BY ar.audit_id, ar.status, ar.created_at, ar.completed_at`,
        [auditId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Get findings
      const findingsResult = await pool.query(
        `SELECT severity, category, description, recommendation, code_location, cwe_id, remediation, status
         FROM audit_findings
         WHERE audit_id = $1
         ORDER BY 
           CASE severity 
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             WHEN 'low' THEN 4
             ELSE 5
           END`,
        [auditId]
      );

      const findings: AuditFinding[] = findingsResult.rows.map(r => ({
        severity: r.severity,
        category: r.category,
        description: r.description,
        recommendation: r.recommendation,
        codeLocation: r.code_location,
        cweId: r.cwe_id,
        remediation: r.remediation
      }));

      // Get certification
      const certResult = await pool.query(
        `SELECT certification_id, certified, compliance_score
         FROM audit_certifications
         WHERE audit_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [auditId]
      );

      const certification = certResult.rows[0];
      const complianceScore = certification?.compliance_score || 0;
      const certified = certification?.certified || false;

      return {
        auditId,
        status: row.status,
        findings,
        complianceScore,
        certified,
        certificationId: certification?.certification_id,
        createdAt: row.created_at,
        completedAt: row.completed_at ? new Date(row.completed_at) : undefined
      };
    } catch (error: any) {
      logger.error('Get audit status failed', { auditId, error: error.message });
      throw error;
    }
  }

  /**
   * Add findings to an audit
   */
  async addFindings(auditId: string, findings: Partial<AuditFinding>[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const finding of findings) {
        await client.query(
          `INSERT INTO audit_findings (
            finding_id, audit_id, severity, category, description, 
            recommendation, code_location, cwe_id, remediation, status
          ) VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            auditId,
            finding.severity,
            finding.category,
            finding.description,
            finding.recommendation,
            finding.codeLocation || null,
            finding.cweId || null,
            finding.remediation || null,
            'open'
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Add findings failed', { auditId, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Complete audit and generate certification
   */
  async completeAudit(
    auditId: string,
    findings: AuditFinding[],
    complianceScore: number
  ): Promise<{ certificationId: string; certified: boolean }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Add findings
      await this.addFindings(auditId, findings);

      // Determine if certified (no critical findings and compliance score >= 80)
      const hasCritical = findings.some(f => f.severity === 'critical');
      const certified = !hasCritical && complianceScore >= 80;

      // Generate certification hash
      const auditData = {
        auditId,
        findings: findings.length,
        complianceScore,
        certified,
        timestamp: new Date().toISOString()
      };
      const certificationHash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify(auditData))
        .digest('hex');

      // Generate quantum signature
      const quantumSignature = await quantumSecurityService.sign(JSON.stringify(auditData));
      
      // Generate backup signature with SPHINCS+
      const sphincsBackup = await quantumSecurityService.signBackup(JSON.stringify(auditData));

      // Create certification
      const certificationId = uuidv4();
      await client.query(
        `INSERT INTO audit_certifications (
          certification_id, audit_id, certified, certification_hash,
          quantum_signature, sphincs_backup_signature, compliance_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          certificationId,
          auditId,
          certified,
          certificationHash,
          quantumSignature,
          sphincsBackup,
          complianceScore
        ]
      );

      // Update audit status
      await client.query(
        `UPDATE audit_requests 
         SET status = 'completed', completed_at = CURRENT_TIMESTAMP
         WHERE audit_id = $1`,
        [auditId]
      );

      await client.query('COMMIT');

      // Emit event
      this.emitAuditCompleted(auditId, certificationId, certified);

      return { certificationId, certified };
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Complete audit failed', { auditId, error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify certification
   */
  async verifyCertification(certificationId: string): Promise<{
    valid: boolean;
    auditId?: string;
    contractAddress?: string;
    certified: boolean;
    expiresAt?: Date;
    revoked: boolean;
  }> {
    try {
      const result = await pool.query(
        `SELECT 
          ac.certification_id, ac.audit_id, ac.certified, ac.expires_at, ac.revoked,
          ar.contract_address
        FROM audit_certifications ac
        JOIN audit_requests ar ON ac.audit_id = ar.audit_id
        WHERE ac.certification_id = $1`,
        [certificationId]
      );

      if (result.rows.length === 0) {
        return { valid: false, certified: false, revoked: false };
      }

      const row = result.rows[0];
      const valid = !row.revoked && (!row.expires_at || new Date(row.expires_at) > new Date());

      return {
        valid,
        auditId: row.audit_id,
        contractAddress: row.contract_address,
        certified: row.certified,
        expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
        revoked: row.revoked
      };
    } catch (error: any) {
      logger.error('Verify certification failed', { certificationId, error: error.message });
      throw error;
    }
  }

  /**
   * Emit audit requested event (placeholder for event bus)
   */
  private emitAuditRequested(auditId: string, request: AuditRequestInput): void {
    // In production, publish to Kafka/RabbitMQ
    logger.info('Audit requested event', { auditId, requestedBy: request.requestedBy });
    
    // Import event bus dynamically to avoid circular dependencies
    import('../events/auditEventHandler').then(({ AuditEventBus }) => {
      AuditEventBus.publishAuditRequired({
        offeringId: request.metadata?.offeringId || '',
        contractCode: request.contractCode,
        contractAddress: request.contractAddress,
        blockchain: request.blockchain,
        requestedBy: request.requestedBy
      }).catch(err => logger.error('Failed to publish audit.required event', { error: err.message }));
    });
  }

  /**
   * Emit audit completed event (placeholder for event bus)
   */
  private emitAuditCompleted(auditId: string, certificationId: string, certified: boolean): void {
    // In production, publish to Kafka/RabbitMQ
    logger.info('Audit completed event', { auditId, certificationId, certified });
    
    // Import event bus dynamically to avoid circular dependencies
    import('../events/auditEventHandler').then(({ AuditEventBus }) => {
      AuditEventBus.publishAuditCompleted({
        auditId,
        certificationId,
        certified
      }).catch(err => logger.error('Failed to publish audit.completed event', { error: err.message }));
    });
  }
}

export const auditService = new AuditService();
