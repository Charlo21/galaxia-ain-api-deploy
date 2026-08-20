-- Migration: Add competitive positioning features
-- Direct payments, privacy, blockchain verification

-- Direct payments table (no platform fees)
CREATE TABLE IF NOT EXISTS direct_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    node_id UUID REFERENCES nodes(id),
    amount DECIMAL(18,8) NOT NULL,
    user_wallet VARCHAR(255) NOT NULL,
    node_wallet VARCHAR(255) NOT NULL,
    tx_hash VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP
);

CREATE INDEX idx_direct_payments_task ON direct_payments(task_id);
CREATE INDEX idx_direct_payments_user ON direct_payments(user_id);
CREATE INDEX idx_direct_payments_node ON direct_payments(node_id);
CREATE INDEX idx_direct_payments_status ON direct_payments(status);

-- Blockchain records table (tamper-proof)
CREATE TABLE IF NOT EXISTS blockchain_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    block_hash VARCHAR(255) NOT NULL,
    transaction_hash VARCHAR(255) NOT NULL,
    signature TEXT NOT NULL,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_blockchain_records_task ON blockchain_records(task_id);
CREATE INDEX idx_blockchain_records_verified ON blockchain_records(verified);

-- Privacy settings table
CREATE TABLE IF NOT EXISTS privacy_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    privacy_level VARCHAR(20) DEFAULT 'public', -- public, private, confidential
    encrypt_input BOOLEAN DEFAULT false,
    use_zk_proof BOOLEAN DEFAULT false,
    hide_output BOOLEAN DEFAULT false,
    zk_proof TEXT,
    encryption_key TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_privacy_settings_task ON privacy_settings(task_id);
CREATE INDEX idx_privacy_settings_level ON privacy_settings(privacy_level);

-- Verifiable computation proofs
CREATE TABLE IF NOT EXISTS computation_proofs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    proof TEXT NOT NULL,
    public_inputs JSONB,
    verification_key TEXT NOT NULL,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_computation_proofs_task ON computation_proofs(task_id);
CREATE INDEX idx_computation_proofs_verified ON computation_proofs(verified);

-- Add privacy_level to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS privacy_level VARCHAR(20) DEFAULT 'public';
CREATE INDEX IF NOT EXISTS idx_tasks_privacy ON tasks(privacy_level);

-- Add platform_fee_percent to track efficiency (should be 0 for direct payments)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS platform_fee_percent DECIMAL(5,2) DEFAULT 0.0;

