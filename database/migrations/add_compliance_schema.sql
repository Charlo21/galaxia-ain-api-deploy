-- Galaxia Compliance Framework Database Schema
-- Comprehensive compliance infrastructure for MiCA, US, UK, and global regulations

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For encryption functions

-- ============================================================================
-- KYC/AML COMPLIANCE TABLES
-- ============================================================================

-- KYC verification levels
CREATE TYPE kyc_level AS ENUM ('none', 'basic', 'intermediate', 'advanced', 'institutional');
CREATE TYPE kyc_status AS ENUM ('pending', 'in_review', 'approved', 'rejected', 'expired', 'suspended');
CREATE TYPE document_type AS ENUM ('passport', 'drivers_license', 'national_id', 'proof_of_address', 'source_of_funds', 'beneficial_ownership');

-- KYC profiles table
CREATE TABLE kyc_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kyc_level kyc_level DEFAULT 'none',
    kyc_status kyc_status DEFAULT 'pending',
    verification_tier INTEGER DEFAULT 0, -- 0=none, 1=basic, 2=intermediate, 3=advanced, 4=institutional
    
    -- Personal Information
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    date_of_birth DATE,
    nationality VARCHAR(3), -- ISO 3166-1 alpha-3
    country_of_residence VARCHAR(3),
    
    -- Entity Information (for institutional)
    entity_name VARCHAR(255),
    entity_type VARCHAR(50), -- individual, corporation, partnership, trust, etc.
    registration_number VARCHAR(100),
    tax_id VARCHAR(100),
    
    -- Verification Details
    government_id_verified BOOLEAN DEFAULT false,
    address_verified BOOLEAN DEFAULT false,
    source_of_funds_verified BOOLEAN DEFAULT false,
    pep_check_completed BOOLEAN DEFAULT false,
    sanctions_check_completed BOOLEAN DEFAULT false,
    pep_status VARCHAR(50), -- none, pep, rpep, family_member, close_associate
    sanctions_match BOOLEAN DEFAULT false,
    sanctions_details JSONB,
    
    -- Transaction Limits (based on KYC level)
    daily_limit DECIMAL(18,8) DEFAULT 0,
    monthly_limit DECIMAL(18,8) DEFAULT 0,
    annual_limit DECIMAL(18,8) DEFAULT 0,
    single_transaction_limit DECIMAL(18,8) DEFAULT 0,
    
    -- Compliance Flags
    high_risk_jurisdiction BOOLEAN DEFAULT false,
    high_risk_activity BOOLEAN DEFAULT false,
    requires_enhanced_due_diligence BOOLEAN DEFAULT false,
    
    -- Dates
    verified_at TIMESTAMP,
    expires_at TIMESTAMP, -- Annual re-verification required
    last_reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_profiles_user ON kyc_profiles(user_id);
CREATE INDEX idx_kyc_profiles_status ON kyc_profiles(kyc_status);
CREATE INDEX idx_kyc_profiles_level ON kyc_profiles(kyc_level);
CREATE INDEX idx_kyc_profiles_expires ON kyc_profiles(expires_at);

-- KYC documents table
CREATE TABLE kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kyc_profile_id UUID NOT NULL REFERENCES kyc_profiles(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    document_number VARCHAR(255),
    issuing_country VARCHAR(3),
    issue_date DATE,
    expiry_date DATE,
    
    -- File storage (encrypted)
    file_path TEXT, -- Encrypted path to document storage
    file_hash VARCHAR(255), -- SHA-256 hash for integrity
    encrypted_data BYTEA, -- Encrypted document data
    
    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by UUID, -- Admin user ID
    verified_at TIMESTAMP,
    verification_notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kyc_documents_profile ON kyc_documents(kyc_profile_id);
CREATE INDEX idx_kyc_documents_type ON kyc_documents(document_type);

-- PEP and Sanctions screening results
CREATE TABLE sanctions_screening (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screening_type VARCHAR(50) NOT NULL, -- ofac, un, eu, uk, pep
    
    -- Screening details
    full_name VARCHAR(500),
    date_of_birth DATE,
    nationality VARCHAR(3),
    aliases JSONB, -- Array of known aliases
    
    -- Results
    match_found BOOLEAN DEFAULT false,
    match_score DECIMAL(5,2), -- 0-100 similarity score
    match_details JSONB, -- Detailed match information
    list_name VARCHAR(255), -- Which sanctions list matched
    list_entry_id VARCHAR(255),
    
    -- Status
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    review_decision VARCHAR(50), -- false_positive, confirmed_match, cleared
    review_notes TEXT,
    
    screened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sanctions_screening_user ON sanctions_screening(user_id);
CREATE INDEX idx_sanctions_screening_match ON sanctions_screening(match_found);
CREATE INDEX idx_sanctions_screening_type ON sanctions_screening(screening_type);

-- ============================================================================
-- TRANSACTION MONITORING & COMPLIANCE
-- ============================================================================

-- Transaction monitoring alerts
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE alert_status AS ENUM ('open', 'investigating', 'resolved', 'false_positive', 'escalated');

CREATE TABLE transaction_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    transaction_id UUID REFERENCES token_transactions(id),
    task_id UUID REFERENCES tasks(id),
    
    -- Alert details
    alert_type VARCHAR(100) NOT NULL, -- suspicious_pattern, velocity_check, structuring, high_risk_jurisdiction, sanctions_match, etc.
    severity alert_severity NOT NULL,
    status alert_status DEFAULT 'open',
    
    -- Detection details
    rule_triggered VARCHAR(255), -- Which monitoring rule triggered
    detection_score DECIMAL(5,2), -- Risk score 0-100
    pattern_details JSONB, -- Details about detected pattern
    
    -- Investigation
    assigned_to UUID, -- Compliance officer user ID
    investigation_notes TEXT,
    investigation_started_at TIMESTAMP,
    investigation_completed_at TIMESTAMP,
    
    -- Resolution
    resolved_by UUID,
    resolution_notes TEXT,
    sar_filed BOOLEAN DEFAULT false, -- Suspicious Activity Report
    sar_reference VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transaction_alerts_user ON transaction_alerts(user_id);
CREATE INDEX idx_transaction_alerts_status ON transaction_alerts(status);
CREATE INDEX idx_transaction_alerts_severity ON transaction_alerts(severity);
CREATE INDEX idx_transaction_alerts_type ON transaction_alerts(alert_type);

-- Travel Rule compliance (FinCEN, MiCA, UK)
CREATE TABLE travel_rule_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES token_transactions(id),
    
    -- Originator Information (required for transactions > threshold)
    originator_name VARCHAR(255),
    originator_account_number VARCHAR(255),
    originator_address TEXT,
    originator_dob DATE,
    originator_identification_type VARCHAR(50),
    originator_identification_number VARCHAR(255),
    originator_country VARCHAR(3),
    
    -- Beneficiary Information
    beneficiary_name VARCHAR(255),
    beneficiary_account_number VARCHAR(255),
    beneficiary_address TEXT,
    beneficiary_country VARCHAR(3),
    
    -- Transaction Details
    transaction_amount DECIMAL(18,8) NOT NULL,
    transaction_currency VARCHAR(10) DEFAULT 'GXA',
    transaction_date TIMESTAMP NOT NULL,
    
    -- VASP Information
    originator_vasp_name VARCHAR(255),
    originator_vasp_identifier VARCHAR(255), -- LEI or registration number
    beneficiary_vasp_name VARCHAR(255),
    beneficiary_vasp_identifier VARCHAR(255),
    
    -- Compliance
    threshold_exceeded BOOLEAN DEFAULT false,
    threshold_amount DECIMAL(18,8), -- US: $3000, UK: £1000, EU: €1000
    jurisdiction VARCHAR(3), -- Which jurisdiction's rules apply
    
    -- Data transmission
    transmitted_to_vasp BOOLEAN DEFAULT false,
    transmission_method VARCHAR(50), -- api, email, blockchain, etc.
    transmission_timestamp TIMESTAMP,
    transmission_reference VARCHAR(255),
    
    -- Storage
    data_encrypted BOOLEAN DEFAULT true,
    retention_until TIMESTAMP, -- 5 years minimum
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_travel_rule_transaction ON travel_rule_records(transaction_id);
CREATE INDEX idx_travel_rule_threshold ON travel_rule_records(threshold_exceeded);
CREATE INDEX idx_travel_rule_jurisdiction ON travel_rule_records(jurisdiction);

-- Suspicious Activity Reports (SAR/STR)
CREATE TABLE suspicious_activity_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID REFERENCES transaction_alerts(id),
    user_id UUID REFERENCES users(id),
    
    -- Report details
    report_type VARCHAR(50) NOT NULL, -- sar, str (Suspicious Transaction Report)
    jurisdiction VARCHAR(3) NOT NULL, -- Which regulator
    report_number VARCHAR(255) UNIQUE, -- Official report reference
    
    -- Activity details
    activity_type VARCHAR(100),
    activity_description TEXT,
    suspected_violation VARCHAR(255),
    transaction_ids UUID[], -- Related transactions
    
    -- Filing
    filed_by UUID NOT NULL, -- Compliance officer
    filed_at TIMESTAMP NOT NULL,
    filing_method VARCHAR(50), -- electronic, paper
    filing_reference VARCHAR(255),
    
    -- Status
    status VARCHAR(50) DEFAULT 'draft', -- draft, filed, acknowledged, closed
    regulator_acknowledgment_received BOOLEAN DEFAULT false,
    acknowledgment_reference VARCHAR(255),
    
    -- Follow-up
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_notes TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sar_alert ON suspicious_activity_reports(alert_id);
CREATE INDEX idx_sar_user ON suspicious_activity_reports(user_id);
CREATE INDEX idx_sar_status ON suspicious_activity_reports(status);
CREATE INDEX idx_sar_jurisdiction ON suspicious_activity_reports(jurisdiction);

-- ============================================================================
-- JURISDICTION & GEO-BLOCKING
-- ============================================================================

-- User jurisdiction detection
CREATE TABLE user_jurisdictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Detection
    ip_address INET,
    detected_country VARCHAR(3), -- ISO 3166-1 alpha-3
    detected_region VARCHAR(100),
    detected_city VARCHAR(100),
    detection_method VARCHAR(50), -- ip_geolocation, self_declared, document_verification
    
    -- Self-declared
    declared_country VARCHAR(3),
    declared_region VARCHAR(100),
    tax_residence_country VARCHAR(3),
    
    -- Compliance
    jurisdiction_status VARCHAR(50) DEFAULT 'allowed', -- allowed, restricted, blocked, requires_license
    geo_blocked BOOLEAN DEFAULT false,
    blocking_reason TEXT,
    license_required BOOLEAN DEFAULT false,
    license_held BOOLEAN DEFAULT false,
    
    -- Regulatory requirements
    requires_kyc BOOLEAN DEFAULT true,
    requires_tax_reporting BOOLEAN DEFAULT false,
    requires_disclosures BOOLEAN DEFAULT true,
    
    -- Dates
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

CREATE INDEX idx_user_jurisdictions_user ON user_jurisdictions(user_id);
CREATE INDEX idx_user_jurisdictions_country ON user_jurisdictions(detected_country);
CREATE INDEX idx_user_jurisdictions_blocked ON user_jurisdictions(geo_blocked);

-- ============================================================================
-- LEGAL DOCUMENTATION & CONSENT
-- ============================================================================

-- Legal document versions
CREATE TABLE legal_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type VARCHAR(50) NOT NULL, -- terms_of_service, privacy_policy, risk_disclosure, cookie_policy, etc.
    version VARCHAR(20) NOT NULL,
    jurisdiction VARCHAR(3), -- NULL for global, or specific country code
    
    -- Content
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL, -- Full document text
    summary TEXT, -- Brief summary
    
    -- Metadata
    effective_date DATE NOT NULL,
    expiry_date DATE,
    mandatory BOOLEAN DEFAULT true, -- Must be accepted to use service
    requires_reacceptance BOOLEAN DEFAULT false, -- Force re-acceptance on update
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_current BOOLEAN DEFAULT false, -- Only one current version per type/jurisdiction
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_legal_documents_type ON legal_documents(document_type);
CREATE INDEX idx_legal_documents_jurisdiction ON legal_documents(jurisdiction);
CREATE INDEX idx_legal_documents_active ON legal_documents(is_active, is_current);

-- User consent tracking
CREATE TABLE user_consents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES legal_documents(id),
    
    -- Consent details
    consented BOOLEAN NOT NULL,
    consent_method VARCHAR(50), -- web_ui, api, email, etc.
    ip_address INET,
    user_agent TEXT,
    
    -- Version tracking
    document_version VARCHAR(20) NOT NULL,
    
    consented_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, document_id, document_version)
);

CREATE INDEX idx_user_consents_user ON user_consents(user_id);
CREATE INDEX idx_user_consents_document ON user_consents(document_id);

-- ============================================================================
-- COMPLAINTS & DISPUTE RESOLUTION
-- ============================================================================

CREATE TYPE complaint_status AS ENUM ('submitted', 'acknowledged', 'under_review', 'resolved', 'escalated', 'closed');
CREATE TYPE complaint_category AS ENUM ('service_issue', 'billing', 'security', 'privacy', 'compliance', 'other');

CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    complaint_number VARCHAR(50) UNIQUE NOT NULL, -- User-facing reference
    
    -- Complaint details
    category complaint_category NOT NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
    
    -- Related items
    related_transaction_id UUID REFERENCES token_transactions(id),
    related_task_id UUID REFERENCES tasks(id),
    
    -- Status
    status complaint_status DEFAULT 'submitted',
    assigned_to UUID, -- Support/compliance staff
    
    -- Timeline (MiCA: 15 business days response)
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    acknowledged_by UUID,
    response_due_date TIMESTAMP, -- 15 business days from submission
    first_response_at TIMESTAMP,
    resolved_at TIMESTAMP,
    closed_at TIMESTAMP,
    
    -- Resolution
    resolution_notes TEXT,
    resolution_satisfactory BOOLEAN,
    escalated_to_regulator BOOLEAN DEFAULT false,
    regulator_reference VARCHAR(255),
    
    -- Internal
    internal_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_complaints_user ON complaints(user_id);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_number ON complaints(complaint_number);
CREATE INDEX idx_complaints_due_date ON complaints(response_due_date);

-- ============================================================================
-- AUDIT TRAILS & LOGGING
-- ============================================================================

-- Comprehensive audit log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor
    user_id UUID REFERENCES users(id),
    admin_user_id UUID, -- If action by admin
    api_key_id UUID REFERENCES api_keys(id),
    ip_address INET,
    user_agent TEXT,
    
    -- Action
    action_type VARCHAR(100) NOT NULL, -- user_login, transaction_created, kyc_submitted, document_uploaded, etc.
    resource_type VARCHAR(50), -- user, transaction, kyc_profile, etc.
    resource_id UUID,
    
    -- Details
    action_description TEXT,
    request_data JSONB, -- Request payload (sanitized)
    response_data JSONB, -- Response data (sanitized)
    changes JSONB, -- What changed (before/after)
    
    -- Compliance
    compliance_relevant BOOLEAN DEFAULT false,
    requires_retention BOOLEAN DEFAULT true,
    retention_until TIMESTAMP, -- Minimum 5 years for compliance
    
    -- Metadata
    session_id VARCHAR(255),
    request_id VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_compliance ON audit_logs(compliance_relevant);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Data access log (GDPR requirement)
CREATE TABLE data_access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Access details
    accessed_by UUID, -- Who accessed (user or admin)
    access_type VARCHAR(50) NOT NULL, -- view, export, delete, modify
    data_category VARCHAR(100), -- personal_info, transactions, kyc_data, etc.
    
    -- What was accessed
    resource_type VARCHAR(50),
    resource_id UUID,
    fields_accessed TEXT[], -- Which fields/data points
    
    -- Purpose
    access_purpose VARCHAR(255), -- user_request, compliance_review, legal_obligation, etc.
    legal_basis VARCHAR(100), -- consent, contract, legal_obligation, legitimate_interest
    
    -- Metadata
    ip_address INET,
    user_agent TEXT,
    
    accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_data_access_user ON data_access_logs(user_id);
CREATE INDEX idx_data_access_type ON data_access_logs(access_type);
CREATE INDEX idx_data_access_accessed_by ON data_access_logs(accessed_by);

-- ============================================================================
-- REGULATORY REPORTING
-- ============================================================================

CREATE TYPE report_type AS ENUM ('transaction_report', 'suspicious_activity', 'large_transaction', 'compliance_audit', 'annual_report');
CREATE TYPE report_status AS ENUM ('draft', 'generated', 'submitted', 'acknowledged', 'rejected');

CREATE TABLE regulatory_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Report details
    report_type report_type NOT NULL,
    jurisdiction VARCHAR(3) NOT NULL,
    reporting_period_start DATE,
    reporting_period_end DATE,
    
    -- Generation
    generated_by UUID, -- System or admin user
    generated_at TIMESTAMP,
    report_data JSONB, -- Full report data
    report_file_path TEXT, -- Path to generated PDF/CSV
    
    -- Submission
    status report_status DEFAULT 'draft',
    submitted_at TIMESTAMP,
    submitted_by UUID,
    submission_method VARCHAR(50), -- electronic, email, portal
    submission_reference VARCHAR(255),
    
    -- Acknowledgment
    regulator_acknowledged BOOLEAN DEFAULT false,
    acknowledgment_reference VARCHAR(255),
    acknowledgment_received_at TIMESTAMP,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_regulatory_reports_type ON regulatory_reports(report_type);
CREATE INDEX idx_regulatory_reports_jurisdiction ON regulatory_reports(jurisdiction);
CREATE INDEX idx_regulatory_reports_status ON regulatory_reports(status);

-- ============================================================================
-- DATA RETENTION & DELETION
-- ============================================================================

-- Data retention policies
CREATE TABLE data_retention_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    data_category VARCHAR(100) NOT NULL, -- transactions, kyc_data, audit_logs, etc.
    jurisdiction VARCHAR(3), -- NULL for global default
    
    -- Retention rules
    retention_period_years INTEGER NOT NULL, -- Minimum retention period
    legal_basis TEXT, -- Why we must retain (AML, tax, etc.)
    
    -- Deletion
    auto_delete_after_retention BOOLEAN DEFAULT false,
    requires_approval BOOLEAN DEFAULT true,
    
    -- Exceptions
    legal_hold BOOLEAN DEFAULT false, -- Prevent deletion during legal proceedings
    active_investigation BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Data deletion requests (GDPR right to erasure)
CREATE TABLE data_deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Request details
    request_type VARCHAR(50) NOT NULL, -- full_deletion, partial_deletion, account_deletion
    data_categories TEXT[], -- Which data categories to delete
    reason TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected, completed
    reviewed_by UUID,
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    
    -- Legal holds
    legal_hold_active BOOLEAN DEFAULT false,
    legal_hold_reason TEXT,
    cannot_delete_reason TEXT,
    
    -- Execution
    approved_by UUID,
    approved_at TIMESTAMP,
    deletion_started_at TIMESTAMP,
    deletion_completed_at TIMESTAMP,
    deletion_summary JSONB, -- What was deleted
    
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deletion_requests_user ON data_deletion_requests(user_id);
CREATE INDEX idx_deletion_requests_status ON data_deletion_requests(status);

-- ============================================================================
-- SECURITY INCIDENTS & BREACH NOTIFICATION
-- ============================================================================

CREATE TYPE incident_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE incident_status AS ENUM ('detected', 'contained', 'investigating', 'resolved', 'reported');

CREATE TABLE security_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Incident details
    incident_type VARCHAR(100) NOT NULL, -- data_breach, unauthorized_access, system_compromise, etc.
    severity incident_severity NOT NULL,
    status incident_status DEFAULT 'detected',
    
    -- Description
    description TEXT NOT NULL,
    affected_systems TEXT[],
    affected_users_count INTEGER,
    affected_data_categories TEXT[], -- personal_info, financial_data, etc.
    
    -- Detection
    detected_at TIMESTAMP NOT NULL,
    detected_by UUID,
    detection_method VARCHAR(100),
    
    -- Response
    contained_at TIMESTAMP,
    contained_by UUID,
    containment_measures TEXT,
    
    -- Investigation
    investigated_by UUID,
    investigation_started_at TIMESTAMP,
    investigation_completed_at TIMESTAMP,
    root_cause TEXT,
    
    -- Notification (GDPR: 72 hours)
    gdpr_notification_required BOOLEAN DEFAULT false,
    gdpr_notification_sent BOOLEAN DEFAULT false,
    gdpr_notification_sent_at TIMESTAMP,
    regulator_notified BOOLEAN DEFAULT false,
    regulator_notified_at TIMESTAMP,
    regulator_reference VARCHAR(255),
    users_notified BOOLEAN DEFAULT false,
    users_notified_at TIMESTAMP,
    
    -- Resolution
    resolved_at TIMESTAMP,
    resolved_by UUID,
    remediation_measures TEXT,
    prevention_measures TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_security_incidents_status ON security_incidents(status);
CREATE INDEX idx_security_incidents_severity ON security_incidents(severity);
CREATE INDEX idx_security_incidents_type ON security_incidents(incident_type);

-- ============================================================================
-- COMPLIANCE CONFIGURATION
-- ============================================================================

-- Compliance configuration per jurisdiction
CREATE TABLE compliance_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    jurisdiction VARCHAR(3) NOT NULL,
    
    -- KYC Requirements
    kyc_required BOOLEAN DEFAULT true,
    kyc_threshold_amount DECIMAL(18,8), -- Amount triggering KYC
    kyc_refresh_period_months INTEGER DEFAULT 12,
    
    -- Transaction Monitoring
    travel_rule_threshold DECIMAL(18,8), -- US: 3000, UK: 1000, EU: 1000
    ctr_threshold DECIMAL(18,8), -- Currency Transaction Report threshold
    ltr_threshold DECIMAL(18,8), -- Large Transaction Report threshold
    
    -- Reporting
    sar_filing_required BOOLEAN DEFAULT true,
    sar_filing_deadline_days INTEGER DEFAULT 30,
    annual_reporting_required BOOLEAN DEFAULT true,
    
    -- Data Protection
    data_retention_years INTEGER DEFAULT 5,
    gdpr_applicable BOOLEAN DEFAULT false,
    
    -- Licensing
    license_required BOOLEAN DEFAULT false,
    license_type VARCHAR(100), -- money_transmitter, crypto_exchange, etc.
    license_number VARCHAR(255),
    license_status VARCHAR(50),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(jurisdiction)
);

-- Insert default configurations
INSERT INTO compliance_config (jurisdiction, travel_rule_threshold, ctr_threshold, gdpr_applicable) VALUES
('USA', 3000.0, 10000.0, false),
('GBR', 1000.0, 10000.0, false),
('AUT', 1000.0, 15000.0, true),
('BEL', 1000.0, 15000.0, true),
('BGR', 1000.0, 15000.0, true),
('HRV', 1000.0, 15000.0, true),
('CYP', 1000.0, 15000.0, true),
('CZE', 1000.0, 15000.0, true),
('DNK', 1000.0, 15000.0, true),
('EST', 1000.0, 15000.0, true),
('FIN', 1000.0, 15000.0, true),
('FRA', 1000.0, 15000.0, true),
('DEU', 1000.0, 15000.0, true),
('GRC', 1000.0, 15000.0, true),
('HUN', 1000.0, 15000.0, true),
('IRL', 1000.0, 15000.0, true),
('ITA', 1000.0, 15000.0, true),
('LVA', 1000.0, 15000.0, true),
('LTU', 1000.0, 15000.0, true),
('LUX', 1000.0, 15000.0, true),
('MLT', 1000.0, 15000.0, true),
('NLD', 1000.0, 15000.0, true),
('POL', 1000.0, 15000.0, true),
('PRT', 1000.0, 15000.0, true),
('ROU', 1000.0, 15000.0, true),
('SVK', 1000.0, 15000.0, true),
('SVN', 1000.0, 15000.0, true),
('ESP', 1000.0, 15000.0, true),
('SWE', 1000.0, 15000.0, true);

