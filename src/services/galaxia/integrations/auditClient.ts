/**
 * Galaxia Audit Client
 * Smart contract security auditing platform integration
 */

import { getGalaxiaEcosystem } from '../ecosystem';
import { quantumSecurityService } from '../quantumSecurity';
import { logger } from '../../../index';

export interface AuditRequest {
  contractAddress?: string;
  contractCode: string;
  blockchain: 'constellation' | 'ethereum' | 'polygon' | 'solana' | 'near';
  auditType: 'automated' | 'manual' | 'formal-verification' | 'full';
  priority: 'standard' | 'expedited' | 'critical';
  requestedBy: string; // appId
  complianceRequirements?: ('securities' | 'aml' | 'gdpr')[];
  metadata?: Record<string, any>;
}

export interface AuditFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  recommendation: string;
  codeLocation?: string; // line:column
  cweId?: string; // Common Weakness Enumeration ID
  remediation?: string;
}

export interface AuditStatus {
  auditId: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  findings: AuditFinding[];
  complianceScore: number; // 0-100
  certified: boolean;
  certificationId?: string;
  createdAt: Date;
  completedAt?: Date;
  estimatedCompletion?: Date;
}

export interface AuditReport {
  auditId: string;
  contractAddress?: string;
  blockchain: string;
  auditType: string;
  findings: AuditFinding[];
  complianceScore: number;
  certified: boolean;
  certificationId?: string;
  quantumSignature: string;
  reportHash: string;
  generatedAt: Date;
  auditor?: string;
  reportUrl?: string;
}

export interface MonitoringConfig {
  contractAddress: string;
  alertThresholds: {
    newFindings?: boolean;
    criticalFindings?: boolean;
    complianceScoreDrop?: number; // threshold percentage
  };
  notificationEndpoint?: string;
  checkInterval?: number; // milliseconds
}

export class GalaxiaAuditClient {
  private baseUrl: string;
  private quantumEnabled: boolean;
  private ecosystemService = getGalaxiaEcosystem();

  constructor(config: {
    quantum?: boolean;
    baseUrl?: string;
  } = {}) {
    this.baseUrl = config.baseUrl || process.env.GALAXIA_AUDIT_URL || 'https://audit.galaxia.io';
    this.quantumEnabled = config.quantum !== false;
  }

  /**
   * Request a smart contract audit
   */
  async requestAudit(request: AuditRequest): Promise<{ auditId: string; status: string }> {
    try {
      const headers: Record<string, string> = {
        'X-Galaxia-App': 'galaxia-ai-infrastructure',
        'X-Galaxia-Version': '1.0.0',
        'Content-Type': 'application/json'
      };

      // Add quantum security headers
      if (this.quantumEnabled) {
        const quantumHeaders = await quantumSecurityService.generateRequestHeaders();
        Object.assign(headers, quantumHeaders);
      }

      const response = await this.ecosystemService.request<{
        success: boolean;
        data: { auditId: string; status: string };
      }>('POST', `${this.baseUrl}/api/v1/audit/request`, request, { headers });

      return response.data;
    } catch (error: any) {
      logger.error('Audit request failed', {
        error: error.message,
        contractAddress: request.contractAddress
      });
      throw new Error(`Audit request failed: ${error.message}`);
    }
  }

  /**
   * Get audit status
   */
  async getAuditStatus(auditId: string): Promise<AuditStatus> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: AuditStatus;
      }>('GET', `${this.baseUrl}/api/v1/audit/${auditId}/status`);

      return {
        ...response.data,
        createdAt: new Date(response.data.createdAt),
        completedAt: response.data.completedAt ? new Date(response.data.completedAt) : undefined,
        estimatedCompletion: response.data.estimatedCompletion ? new Date(response.data.estimatedCompletion) : undefined
      };
    } catch (error: any) {
      logger.error('Get audit status failed', { auditId, error: error.message });
      throw new Error(`Get audit status failed: ${error.message}`);
    }
  }

  /**
   * Get audit report
   */
  async getAuditReport(auditId: string, format: 'json' | 'pdf' = 'json'): Promise<AuditReport | Buffer> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: AuditReport;
      }>('GET', `${this.baseUrl}/api/v1/audit/${auditId}/report?format=${format}`);

      if (format === 'pdf') {
        // PDF is returned as buffer
        return response as any as Buffer;
      }

      return {
        ...response.data,
        generatedAt: new Date(response.data.generatedAt)
      };
    } catch (error: any) {
      logger.error('Get audit report failed', { auditId, error: error.message });
      throw new Error(`Get audit report failed: ${error.message}`);
    }
  }

  /**
   * Verify audit certification
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
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: {
          valid: boolean;
          auditId?: string;
          contractAddress?: string;
          certified: boolean;
          expiresAt?: string;
          revoked: boolean;
        };
      }>('GET', `${this.baseUrl}/api/v1/audit/certification/${certificationId}/verify`);

      return {
        ...response.data,
        expiresAt: response.data.expiresAt ? new Date(response.data.expiresAt) : undefined
      };
    } catch (error: any) {
      logger.error('Verify certification failed', { certificationId, error: error.message });
      throw new Error(`Verify certification failed: ${error.message}`);
    }
  }

  /**
   * Set up continuous monitoring for a contract
   */
  async startMonitoring(config: MonitoringConfig): Promise<{ monitoringId: string }> {
    try {
      const response = await this.ecosystemService.request<{
        success: boolean;
        data: { monitoringId: string };
      }>('POST', `${this.baseUrl}/api/v1/audit/monitor`, config);

      return response.data;
    } catch (error: any) {
      logger.error('Start monitoring failed', {
        contractAddress: config.contractAddress,
        error: error.message
      });
      throw new Error(`Start monitoring failed: ${error.message}`);
    }
  }

  /**
   * Stop monitoring for a contract
   */
  async stopMonitoring(monitoringId: string): Promise<void> {
    try {
      await this.ecosystemService.request('DELETE', `${this.baseUrl}/api/v1/audit/monitor/${monitoringId}`);
    } catch (error: any) {
      logger.error('Stop monitoring failed', { monitoringId, error: error.message });
      throw new Error(`Stop monitoring failed: ${error.message}`);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.ecosystemService.request<{ success: boolean }>(
        'GET',
        `${this.baseUrl}/health`
      );
      return response.success !== false;
    } catch {
      return false;
    }
  }
}
