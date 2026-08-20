-- Migration: Add integration fields for new Galaxia applications
-- Adds support for Galaxia Clearing and Constellation L1 integration

-- Add clearing_id to token_transactions for Galaxia Clearing integration
ALTER TABLE token_transactions 
ADD COLUMN IF NOT EXISTS clearing_id VARCHAR(255);

-- Add blockchain_hash for Constellation L1 transactions (rename from blockchain_tx_hash for consistency)
-- Note: blockchain_tx_hash already exists, so we'll use it, but add blockchain_hash as alias
ALTER TABLE token_transactions 
ADD COLUMN IF NOT EXISTS blockchain_hash VARCHAR(255);

-- Create index on clearing_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_token_transactions_clearing ON token_transactions(clearing_id);

-- Create index on blockchain_hash for faster lookups
CREATE INDEX IF NOT EXISTS idx_token_transactions_blockchain ON token_transactions(blockchain_hash);

-- Update existing blockchain_tx_hash to also populate blockchain_hash for backward compatibility
UPDATE token_transactions 
SET blockchain_hash = blockchain_tx_hash 
WHERE blockchain_tx_hash IS NOT NULL AND blockchain_hash IS NULL;
