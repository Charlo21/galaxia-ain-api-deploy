-- Migration: Add Galaxia Audit and Galaxia Issuance tables
-- Date: 2026-01-25
-- Description: Adds database tables for smart contract auditing and securities token issuance

-- ==================== GALAXIA AUDIT TABLES ====================

-- Audit requests table
CREATE TABLE IF NOT EXISTS audit_requests (
    audit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_address VARCHAR(66),
    contract_code TEXT NOT NULL,
    blockchain VARCHAR(50) NOT NULL, -- constellation, ethereum, polygon, solana, near
    audit_type VARCHAR(20) NOT NULL, -- automated, manual, formal-verification, full
    priority VARCHAR(20) DEFAULT 'standard', -- standard, expedited, critical
    requesting_app VARCHAR(50) NOT NULL,
    compliance_requirements TEXT[], -- securities, aml, gdpr
    status VARCHAR(20) DEFAULT 'pending', -- pending, in-progress, completed, failed
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_requests_status ON audit_requests(status);
CREATE INDEX idx_audit_requests_contract ON audit_requests(contract_address);
CREATE INDEX idx_audit_requests_blockchain ON audit_requests(blockchain);
CREATE INDEX idx_audit_requests_created ON audit_requests(created_at DESC);
CREATE INDEX idx_audit_requests_requesting_app ON audit_requests(requesting_app);

-- Audit findings table
CREATE TABLE IF NOT EXISTS audit_findings (
    finding_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audit_requests(audit_id) ON DELETE CASCADE,
    severity VARCHAR(10) NOT NULL, -- critical, high, medium, low, info
    category VARCHAR(50) NOT NULL, -- reentrancy, overflow, access-control, etc.
    description TEXT NOT NULL,
    recommendation TEXT,
    code_location VARCHAR(100), -- line:column
    cwe_id VARCHAR(20), -- Common Weakness Enumeration ID
    remediation TEXT,
    status VARCHAR(20) DEFAULT 'open', -- open, fixed, false-positive, accepted-risk
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE INDEX idx_audit_findings_audit ON audit_findings(audit_id);
CREATE INDEX idx_audit_findings_severity ON audit_findings(severity);
CREATE INDEX idx_audit_findings_category ON audit_findings(category);
CREATE INDEX idx_audit_findings_status ON audit_findings(status);

-- Audit certifications table
CREATE TABLE IF NOT EXISTS audit_certifications (
    certification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_id UUID NOT NULL REFERENCES audit_requests(audit_id) ON DELETE CASCADE,
    certified BOOLEAN NOT NULL,
    certification_hash VARCHAR(64) NOT NULL,
    quantum_signature TEXT NOT NULL, -- Dilithium signature
    sphincs_backup_signature TEXT, -- SPHINCS+ backup signature
    compliance_score INTEGER, -- 0-100
    expires_at TIMESTAMP,
    revoked BOOLEAN DEFAULT false,
    revoked_at TIMESTAMP,
    revoked_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_certifications_audit ON audit_certifications(audit_id);
CREATE INDEX idx_audit_certifications_certified ON audit_certifications(certified);
CREATE INDEX idx_audit_certifications_hash ON audit_certifications(certification_hash);
CREATE INDEX idx_audit_certifications_revoked ON audit_certifications(revoked);

-- Continuous monitoring table
CREATE TABLE IF NOT EXISTS audit_monitoring (
    monitoring_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contract_address VARCHAR(66) NOT NULL,
    audit_id UUID REFERENCES audit_requests(audit_id),
    alert_thresholds JSONB NOT NULL,
    notification_endpoint TEXT,
    check_interval INTEGER DEFAULT 3600000, -- milliseconds (1 hour default)
    is_active BOOLEAN DEFAULT true,
    last_check_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_monitoring_contract ON audit_monitoring(contract_address);
CREATE INDEX idx_audit_monitoring_active ON audit_monitoring(is_active);

-- ==================== GALAXIA ISSUANCE TABLES ====================

-- Offerings table
CREATE TABLE IF NOT EXISTS offerings (
    offering_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_type VARCHAR(20) NOT NULL, -- reg-d, reg-a, reg-s, reg-cf
    security_type VARCHAR(20) NOT NULL, -- equity, debt, hybrid, derivative
    issuer_id UUID NOT NULL, -- References issuer entity (could be users table or separate)
    issuer_details JSONB NOT NULL,
    audit_certification_id UUID REFERENCES audit_certifications(certification_id),
    offering_amount DECIMAL(20,2) NOT NULL,
    token_contract_address VARCHAR(66),
    token_name VARCHAR(100) NOT NULL,
    token_symbol VARCHAR(10) NOT NULL,
    total_supply DECIMAL(20,8) NOT NULL,
    decimals INTEGER DEFAULT 18,
    transfer_restrictions JSONB NOT NULL,
    status VARCHAR(30) DEFAULT 'draft', -- draft, pending_audit, ready_for_issuance, active, closed, cancelled
    compliance_status JSONB NOT NULL DEFAULT '{}',
    compliance_documents JSONB DEFAULT '[]',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP,
    closed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_offerings_status ON offerings(status);
CREATE INDEX idx_offerings_issuer ON offerings(issuer_id);
CREATE INDEX idx_offerings_type ON offerings(offering_type);
CREATE INDEX idx_offerings_audit_cert ON offerings(audit_certification_id);
CREATE INDEX idx_offerings_token_contract ON offerings(token_contract_address);
CREATE INDEX idx_offerings_created ON offerings(created_at DESC);

-- Investors table
CREATE TABLE IF NOT EXISTS investors (
    investor_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    galaxia_id_user_id UUID, -- References Galaxia ID user
    accreditation_status VARCHAR(20), -- accredited, non-accredited, pending, rejected
    accreditation_type VARCHAR(20), -- income, net-worth, entity, sophisticated
    accreditation_verified_at TIMESTAMP,
    accreditation_expires_at TIMESTAMP,
    verification_method VARCHAR(20), -- self-certified, third-party, automatic
    jurisdiction VARCHAR(10) NOT NULL, -- ISO country code
    kyc_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    kyc_verified_at TIMESTAMP,
    aml_status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    aml_verified_at TIMESTAMP,
    restrictions TEXT[], -- List of restrictions
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_investors_galaxia_id ON investors(galaxia_id_user_id);
CREATE INDEX idx_investors_accreditation ON investors(accreditation_status);
CREATE INDEX idx_investors_jurisdiction ON investors(jurisdiction);
CREATE INDEX idx_investors_kyc ON investors(kyc_status);

-- Token holdings table
CREATE TABLE IF NOT EXISTS token_holdings (
    holding_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id UUID NOT NULL REFERENCES offerings(offering_id) ON DELETE CASCADE,
    investor_id UUID NOT NULL REFERENCES investors(investor_id) ON DELETE CASCADE,
    token_amount DECIMAL(20,8) NOT NULL,
    purchase_price DECIMAL(20,2) NOT NULL,
    purchase_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    vesting_schedule JSONB, -- {startDate, cliffPeriod, vestingPeriod, intervals, vestedAmount, unvestedAmount}
    lockup_end_date TIMESTAMP,
    transfer_restrictions JSONB NOT NULL DEFAULT '{}',
    wallet_address VARCHAR(66) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_token_holdings_offering ON token_holdings(offering_id);
CREATE INDEX idx_token_holdings_investor ON token_holdings(investor_id);
CREATE INDEX idx_token_holdings_wallet ON token_holdings(wallet_address);
CREATE INDEX idx_token_holdings_purchase_date ON token_holdings(purchase_date DESC);

-- Regulatory filings table
CREATE TABLE IF NOT EXISTS regulatory_filings (
    filing_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id UUID NOT NULL REFERENCES offerings(offering_id) ON DELETE CASCADE,
    filing_type VARCHAR(20) NOT NULL, -- form-d, form-c, form-1a
    filing_data JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'draft', -- draft, submitted, approved, rejected, amended
    confirmation_number VARCHAR(100),
    submitted_at TIMESTAMP,
    sec_response JSONB,
    auto_submitted BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_regulatory_filings_offering ON regulatory_filings(offering_id);
CREATE INDEX idx_regulatory_filings_type ON regulatory_filings(filing_type);
CREATE INDEX idx_regulatory_filings_status ON regulatory_filings(status);
CREATE INDEX idx_regulatory_filings_confirmation ON regulatory_filings(confirmation_number);

-- Transfer restrictions log
CREATE TABLE IF NOT EXISTS transfer_restrictions_log (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_id UUID NOT NULL REFERENCES offerings(offering_id) ON DELETE CASCADE,
    from_investor_id UUID REFERENCES investors(investor_id),
    to_investor_id UUID REFERENCES investors(investor_id),
    token_amount DECIMAL(20,8) NOT NULL,
    allowed BOOLEAN NOT NULL,
    restrictions_applied TEXT[],
    reason TEXT,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transfer_restrictions_offering ON transfer_restrictions_log(offering_id);
CREATE INDEX idx_transfer_restrictions_checked ON transfer_restrictions_log(checked_at DESC);

-- Update timestamps triggers
CREATE TRIGGER update_audit_requests_updated_at BEFORE UPDATE ON audit_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_offerings_updated_at BEFORE UPDATE ON offerings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investors_updated_at BEFORE UPDATE ON investors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_token_holdings_updated_at BEFORE UPDATE ON token_holdings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_regulatory_filings_updated_at BEFORE UPDATE ON regulatory_filings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
