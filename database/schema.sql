-- Galaxia AI Network Database Schema
-- PostgreSQL Database for Production

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Nodes table: Stores all registered compute nodes
CREATE TABLE nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) UNIQUE NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    capabilities JSONB NOT NULL, -- {cpu_cores, gpu, ram_gb, models: []}
    location JSONB NOT NULL, -- {country, region, city, lat, lon, ip}
    uptime_score DECIMAL(5,2) DEFAULT 0.0, -- Percentage uptime
    reputation DECIMAL(5,2) DEFAULT 50.0, -- 0-100 reputation score
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_earnings DECIMAL(18,8) DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'offline', -- online, offline, busy, blocked
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    current_load INTEGER DEFAULT 0, -- Number of active tasks
    max_concurrent_tasks INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nodes_status ON nodes(status);
CREATE INDEX idx_nodes_reputation ON nodes(reputation DESC);
CREATE INDEX idx_nodes_location ON nodes USING GIN(location);
CREATE INDEX idx_nodes_last_seen ON nodes(last_seen);

-- Tasks table: All inference tasks
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id VARCHAR(50) NOT NULL, -- llama-3-8b, stable-diffusion, whisper
    input_data TEXT NOT NULL, -- Base64 encoded or JSON
    input_type VARCHAR(20) NOT NULL, -- text, image, audio
    priority VARCHAR(20) DEFAULT 'standard', -- standard, fast
    region VARCHAR(50) DEFAULT 'auto',
    assigned_nodes UUID[] DEFAULT ARRAY[]::UUID[], -- Array of node IDs
    status VARCHAR(20) DEFAULT 'queued', -- queued, assigned, processing, completed, failed
    api_key_id UUID,
    cost_tokens DECIMAL(18,8) DEFAULT 0.0,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_model ON tasks(model_id);
CREATE INDEX idx_tasks_created ON tasks(created_at DESC);
CREATE INDEX idx_tasks_api_key ON tasks(api_key_id);

-- Task results table: Results from each node
CREATE TABLE task_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    output_data TEXT NOT NULL,
    processing_time_ms INTEGER,
    verification_status VARCHAR(20) DEFAULT 'pending', -- pending, verified, disputed, rejected
    similarity_score DECIMAL(5,2), -- For consensus matching
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, node_id)
);

CREATE INDEX idx_task_results_task ON task_results(task_id);
CREATE INDEX idx_task_results_node ON task_results(node_id);
CREATE INDEX idx_task_results_verification ON task_results(verification_status);

-- API keys table: Developer API keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    key_hash VARCHAR(255) UNIQUE NOT NULL, -- Hashed API key
    name VARCHAR(255),
    rate_limit_per_minute INTEGER DEFAULT 100,
    requests_today INTEGER DEFAULT 0,
    last_request_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- User accounts table: Developer accounts
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE,
    wallet_address VARCHAR(255),
    token_balance DECIMAL(18,8) DEFAULT 0.0,
    total_spent DECIMAL(18,8) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_wallet ON users(wallet_address);

-- Token transactions table: Payment history
CREATE TABLE token_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    node_id UUID REFERENCES nodes(id),
    task_id UUID REFERENCES tasks(id),
    amount DECIMAL(18,8) NOT NULL,
    transaction_type VARCHAR(20) NOT NULL, -- deposit, payment, payout, refund
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
    blockchain_tx_hash VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_token_transactions_user ON token_transactions(user_id);
CREATE INDEX idx_token_transactions_node ON token_transactions(node_id);
CREATE INDEX idx_token_transactions_task ON token_transactions(task_id);

-- Node health logs table: Health check history
CREATE TABLE node_health_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    cpu_usage DECIMAL(5,2),
    memory_usage DECIMAL(5,2),
    gpu_usage DECIMAL(5,2),
    active_tasks INTEGER,
    response_time_ms INTEGER,
    is_healthy BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_logs_node ON node_health_logs(node_id);
CREATE INDEX idx_health_logs_created ON node_health_logs(created_at DESC);

-- Consensus results table: Final verified results
CREATE TABLE consensus_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    final_output TEXT NOT NULL,
    consensus_type VARCHAR(20) NOT NULL, -- majority, unanimous, tiebreaker
    agreeing_nodes UUID[] NOT NULL,
    disagreeing_nodes UUID[] DEFAULT ARRAY[]::UUID[],
    confidence_score DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consensus_task ON consensus_results(task_id);

-- Model registry table: Available AI models
CREATE TABLE models (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL, -- llm, image, audio
    cost_per_1k_tokens DECIMAL(10,6) DEFAULT 0.01,
    cost_per_image DECIMAL(10,6) DEFAULT 0.05,
    cost_per_minute DECIMAL(10,6) DEFAULT 0.02,
    is_active BOOLEAN DEFAULT true,
    min_required_ram_gb INTEGER,
    requires_gpu BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default models
INSERT INTO models (id, name, type, cost_per_1k_tokens, cost_per_image, cost_per_minute, min_required_ram_gb, requires_gpu) VALUES
('llama-3-8b', 'Llama 3 8B', 'llm', 0.01, NULL, NULL, 8, false),
('stable-diffusion', 'Stable Diffusion', 'image', NULL, 0.05, NULL, 4, true),
('whisper', 'Whisper Speech-to-Text', 'audio', NULL, NULL, 0.02, 2, false);

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_nodes_updated_at BEFORE UPDATE ON nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

