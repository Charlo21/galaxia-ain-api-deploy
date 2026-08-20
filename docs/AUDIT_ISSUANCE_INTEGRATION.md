# Galaxia Audit & Galaxia Issuance Integration Guide

## Overview

This document describes the integration of **Galaxia Audit** (smart contract auditing) and **Galaxia Issuance** (SEC-compliant securities token issuance) into the Galaxia ecosystem.

## Architecture

### Service Components

1. **Galaxia Audit Service** (`src/services/audit/auditService.ts`)
   - Smart contract vulnerability scanning
   - Manual security review workflows
   - Formal verification
   - Compliance checking
   - Audit report generation and certification

2. **Galaxia Issuance Service** (`src/services/issuance/issuanceService.ts`)
   - Regulation D, A+, S, CF offerings
   - Security token creation and management
   - Investor accreditation verification
   - Cap table management
   - Compliance automation (Form D, Form C filings)
   - Transfer restrictions and lock-up enforcement

3. **Integration Clients** (`src/services/galaxia/integrations/`)
   - `auditClient.ts` - Client for Galaxia Audit API
   - `issuanceClient.ts` - Client for Galaxia Issuance API

4. **Event Handlers** (`src/services/events/auditEventHandler.ts`)
   - Event-driven workflows for audit-before-issuance
   - Integration with event bus (Kafka/RabbitMQ)

## API Endpoints

### Galaxia Audit

#### POST /api/v1/audit/request
Request a smart contract audit.

**Request Body:**
```json
{
  "contractAddress": "0x...",
  "contractCode": "pragma solidity ^0.8.0; ...",
  "blockchain": "constellation",
  "auditType": "full",
  "priority": "expedited",
  "complianceRequirements": ["securities", "aml"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "auditId": "uuid",
    "status": "pending"
  }
}
```

#### GET /api/v1/audit/:auditId/status
Get audit status and findings.

**Response:**
```json
{
  "success": true,
  "data": {
    "auditId": "uuid",
    "status": "completed",
    "findings": [
      {
        "severity": "high",
        "category": "reentrancy",
        "description": "...",
        "recommendation": "..."
      }
    ],
    "complianceScore": 85,
    "certified": true,
    "certificationId": "uuid"
  }
}
```

#### GET /api/v1/audit/certification/:certificationId/verify
Verify audit certification.

### Galaxia Issuance

#### POST /api/v1/issuance/offering
Create a new securities offering.

**Request Body:**
```json
{
  "offeringType": "reg-d",
  "securityType": "equity",
  "issuerDetails": {
    "name": "Company Name",
    "entityType": "LLC",
    "jurisdiction": "US",
    "legalAddress": "123 Main St"
  },
  "offeringAmount": 1000000,
  "tokenDetails": {
    "name": "Security Token",
    "symbol": "ST",
    "totalSupply": 1000000,
    "transferRestrictions": {
      "accreditedOnly": true,
      "lockupPeriod": "P12M"
    }
  },
  "auditCertificationId": "required-uuid"
}
```

#### POST /api/v1/issuance/accreditation/verify
Verify investor accreditation.

#### POST /api/v1/issuance/token/mint
Mint security tokens for an investor.

#### GET /api/v1/issuance/offering/:offeringId/cap-table
Get cap table for an offering.

## Event-Driven Workflows

### Flow 1: Security Token Issuance with Mandatory Audit

```
1. Issuer creates offering in Galaxia Issuance
   ↓
2. Galaxia Issuance emits "audit.required" event
   ↓
3. Galaxia Audit receives event, creates audit request
   ↓
4. Audit completed → "audit.completed" event with certification
   ↓
5. Galaxia Issuance validates audit certification
   ↓
6. Offering status updated to "ready_for_issuance"
   ↓
7. Tokens can be minted
```

### Flow 2: Smart Contract Deployment with Audit

```
1. Any app requests contract deployment
   ↓
2. API Gateway intercepts → triggers Galaxia Audit
   ↓
3. Automated scan runs
   ↓
4. If critical issues found → deployment blocked
   ↓
5. If passed → certification issued
   ↓
6. Contract deployed with audit badge
```

## Database Schema

### Audit Tables

- `audit_requests` - Audit request records
- `audit_findings` - Security findings from audits
- `audit_certifications` - Audit certifications with quantum signatures
- `audit_monitoring` - Continuous monitoring configurations

### Issuance Tables

- `offerings` - Securities offerings
- `investors` - Investor records with accreditation status
- `token_holdings` - Security token holdings
- `regulatory_filings` - SEC filing records
- `transfer_restrictions_log` - Transfer restriction checks

See `database/migrations/add_audit_issuance_tables.sql` for full schema.

## Quantum-Resistant Security

All audit certifications and security token operations use quantum-resistant cryptography:

- **CRYSTALS-Dilithium** - Primary digital signatures
- **SPHINCS+** - Backup signatures
- **CRYSTALS-Kyber** - Key encapsulation

## Compliance Requirements

### Galaxia Audit
- SOC 2 Type II certification
- ISO 27001 information security management
- Auditor independence requirements
- 7-year audit workpaper retention

### Galaxia Issuance
- SEC Registration as Transfer Agent
- Form D filing (Reg D) - within 15 days
- Form 1-A filing (Reg A+)
- Form C filing (Reg CF)
- Accredited investor verification
- Transfer restrictions enforcement
- Bad actor disqualification checks

## Integration with Existing Apps

### High Priority Integrations

**Galaxia Audit:**
- Tokenization Network → Audit all tokens before issuance
- Galaxia Issuance → Mandatory audit requirement
- Galaxia DEX → Audit trading pair contracts
- Constellation L1 → Audit core blockchain contracts

**Galaxia Issuance:**
- Galaxia Audit → Receive audit certification
- Galaxia Compliance → KYC/AML verification
- Galaxia ID → Investor identity management
- Galaxia Wallet → Token custody
- Bank of Galaxia → Escrow and fund management

## Testing

Run integration tests:

```bash
npm test -- tests/integration/audit-issuance.test.ts
```

## Configuration

Environment variables:

```bash
GALAXIA_AUDIT_URL=https://audit.galaxia.io
GALAXIA_ISSUANCE_URL=https://issuance.galaxia.io
QUANTUM_CRYPTO_ENABLED=true
SEC_EDGAR_API_KEY=your-sec-api-key
AUDIT_REQUIRED=true
```

## Deployment

1. Run database migrations:
```bash
psql -U postgres -d galaxia -f database/migrations/add_audit_issuance_tables.sql
```

2. Update docker-compose.yml (already configured)

3. Start services:
```bash
docker-compose up -d
```

## Monitoring

Key metrics to monitor:

- `galaxia_audit_requests_total` - Total audit requests
- `galaxia_audit_duration_seconds` - Audit processing time
- `galaxia_audit_findings_total` - Findings by severity
- `galaxia_issuance_offerings_total` - Total offerings
- `galaxia_issuance_tokens_issued_total` - Tokens issued

## Support

For issues or questions:
- Check logs: `logs/combined.log`
- Review API documentation: `/api-docs`
- Contact: support@galaxia.io
