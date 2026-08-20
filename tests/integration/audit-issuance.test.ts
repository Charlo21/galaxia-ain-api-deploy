/**
 * Integration Tests: Galaxia Audit & Galaxia Issuance
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { pool } from '../../src/config/database';
import { auditService } from '../../src/services/audit/auditService';
import { issuanceService } from '../../src/services/issuance/issuanceService';

describe('Galaxia Audit & Issuance Integration', () => {
  beforeAll(async () => {
    // Run migrations
    // In production, use a test database
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Security Token Issuance with Mandatory Audit', () => {
    test('Security token issuance requires valid audit certification', async () => {
      // Step 1: Create audit request
      const auditRequest = await auditService.createAuditRequest({
        contractCode: 'pragma solidity ^0.8.0; contract Token { ... }',
        blockchain: 'constellation',
        auditType: 'full',
        priority: 'expedited',
        requestedBy: 'galaxia-issuance',
        complianceRequirements: ['securities', 'aml']
      });

      expect(auditRequest.auditId).toBeDefined();
      expect(auditRequest.status).toBe('pending');

      // Step 2: Complete audit with findings
      const findings = [
        {
          severity: 'low' as const,
          category: 'code-quality',
          description: 'Minor code style issue',
          recommendation: 'Follow style guide'
        }
      ];

      const certification = await auditService.completeAudit(
        auditRequest.auditId,
        findings,
        85 // compliance score
      );

      expect(certification.certified).toBe(true);
      expect(certification.certificationId).toBeDefined();

      // Step 3: Create offering with audit certification
      const offering = await issuanceService.createOffering({
        offeringType: 'reg-d',
        securityType: 'equity',
        issuerDetails: {
          name: 'Test Issuer',
          entityType: 'LLC',
          jurisdiction: 'US',
          legalAddress: '123 Main St'
        },
        offeringAmount: 1000000,
        tokenDetails: {
          name: 'Test Security Token',
          symbol: 'TST',
          totalSupply: 1000000,
          transferRestrictions: {
            accreditedOnly: true,
            lockupPeriod: 'P12M'
          }
        },
        auditCertificationId: certification.certificationId
      });

      expect(offering.offeringId).toBeDefined();
      expect(offering.status).toBe('ready_for_issuance');
      expect(offering.auditCertificationId).toBe(certification.certificationId);
    });

    test('Failed audit blocks token issuance', async () => {
      // Create audit with critical findings
      const auditRequest = await auditService.createAuditRequest({
        contractCode: 'pragma solidity ^0.8.0; contract Vulnerable { ... }',
        blockchain: 'constellation',
        auditType: 'full',
        priority: 'critical',
        requestedBy: 'galaxia-issuance'
      });

      const findings = [
        {
          severity: 'critical' as const,
          category: 'reentrancy',
          description: 'Reentrancy vulnerability detected',
          recommendation: 'Use checks-effects-interactions pattern'
        }
      ];

      const certification = await auditService.completeAudit(
        auditRequest.auditId,
        findings,
        45 // Low compliance score
      );

      expect(certification.certified).toBe(false);

      // Attempt to create offering with failed audit
      await expect(
        issuanceService.createOffering({
          offeringType: 'reg-d',
          securityType: 'equity',
          issuerDetails: {
            name: 'Test Issuer',
            entityType: 'LLC',
            jurisdiction: 'US',
            legalAddress: '123 Main St'
          },
          offeringAmount: 1000000,
          tokenDetails: {
            name: 'Test Token',
            symbol: 'TST',
            totalSupply: 1000000,
            transferRestrictions: {}
          },
          auditCertificationId: certification.certificationId
        })
      ).rejects.toThrow('Invalid or uncertified audit');
    });
  });

  describe('Investor Accreditation', () => {
    test('Verify investor accreditation', async () => {
      const investorId = 'test-investor-123';

      const accreditation = await issuanceService.verifyAccreditation({
        investorId,
        accreditationType: 'income',
        verificationType: 'third-party',
        documentation: []
      });

      expect(accreditation.investorId).toBe(investorId);
      expect(accreditation.accredited).toBe(true);
      expect(accreditation.verifiedAt).toBeDefined();
    });

    test('Get accreditation status', async () => {
      const investorId = 'test-investor-123';

      // First verify
      await issuanceService.verifyAccreditation({
        investorId,
        accreditationType: 'income',
        verificationType: 'third-party',
        documentation: []
      });

      // Then get status
      const status = await issuanceService.getAccreditationStatus(investorId);

      expect(status).not.toBeNull();
      expect(status?.accredited).toBe(true);
    });
  });

  describe('Token Minting and Cap Table', () => {
    let offeringId: string;
    let certificationId: string;

    beforeAll(async () => {
      // Create audit and offering
      const auditRequest = await auditService.createAuditRequest({
        contractCode: 'pragma solidity ^0.8.0; contract Token { ... }',
        blockchain: 'constellation',
        auditType: 'full',
        priority: 'standard',
        requestedBy: 'galaxia-issuance'
      });

      const certification = await auditService.completeAudit(
        auditRequest.auditId,
        [],
        90
      );

      certificationId = certification.certificationId;

      const offering = await issuanceService.createOffering({
        offeringType: 'reg-d',
        securityType: 'equity',
        issuerDetails: {
          name: 'Test Issuer',
          entityType: 'LLC',
          jurisdiction: 'US',
          legalAddress: '123 Main St'
        },
        offeringAmount: 1000000,
        tokenDetails: {
          name: 'Test Token',
          symbol: 'TST',
          totalSupply: 1000000,
          transferRestrictions: {}
        },
        auditCertificationId: certificationId
      });

      offeringId = offering.offeringId;
    });

    test('Mint security tokens', async () => {
      const investorId = 'investor-1';

      // Verify accreditation first
      await issuanceService.verifyAccreditation({
        investorId,
        accreditationType: 'income',
        verificationType: 'third-party',
        documentation: []
      });

      // Mint tokens
      const holding = await issuanceService.mintTokens({
        offeringId,
        investorId,
        tokenAmount: 10000,
        walletAddress: '0x1234567890123456789012345678901234567890',
        purchasePrice: 10000,
        purchaseDate: new Date()
      });

      expect(holding.holdingId).toBeDefined();
      expect(holding.tokenAmount).toBe(10000);
      expect(holding.offeringId).toBe(offeringId);
    });

    test('Get cap table', async () => {
      const investorId = 'investor-1';

      // Mint tokens first
      await issuanceService.verifyAccreditation({
        investorId,
        accreditationType: 'income',
        verificationType: 'third-party',
        documentation: []
      });

      await issuanceService.mintTokens({
        offeringId,
        investorId,
        tokenAmount: 10000,
        walletAddress: '0x1234567890123456789012345678901234567890',
        purchasePrice: 10000,
        purchaseDate: new Date()
      });

      // Get cap table
      const capTable = await issuanceService.getCapTable(offeringId);

      expect(capTable.totalShares).toBeGreaterThan(0);
      expect(capTable.holders.length).toBeGreaterThan(0);
    });
  });

  describe('Transfer Restrictions', () => {
    test('Check transfer restrictions', async () => {
      // This would test transfer restriction logic
      // Implementation depends on specific business rules
      expect(true).toBe(true); // Placeholder
    });
  });
});
