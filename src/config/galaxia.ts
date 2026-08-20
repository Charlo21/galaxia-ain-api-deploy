/**
 * Galaxia Ecosystem Configuration
 * Includes integration with 5 new applications:
 * - Galaxia Oracle
 * - Galaxia Clearing
 * - Constellation (L1)
 * - Nebula Studio
 * - Bitcoin Quantum Shield
 */

import { config } from 'dotenv';
import { initializeGalaxiaEcosystem, GalaxiaConfig } from '../services/galaxia/ecosystem';
import { initializeIntegrationClients } from '../services/galaxia/integrations';

config();

export const galaxiaConfig: GalaxiaConfig = {
  apiBaseUrl: process.env.GALAXIA_API_BASE_URL || 'https://api.galaxia.io',
  appName: process.env.GALAXIA_APP_NAME || 'galaxia-ai-network',
  appVersion: process.env.GALAXIA_APP_VERSION || '1.0.0',
  chainId: process.env.GALAXIA_CHAIN_ID || 'galaxia-mainnet',
  apiKey: process.env.GALAXIA_API_KEY,
};

// Initialize Galaxia ecosystem service
export const galaxiaEcosystem = initializeGalaxiaEcosystem(galaxiaConfig);

// Initialize new integration clients
export const integrationClients = initializeIntegrationClients();

// Export individual clients for convenience
export const {
  oracle: galaxiaOracle,
  clearing: galaxiaClearing,
  constellation: constellationL1,
  nebula: nebulaStudio,
  btcShield: bitcoinQuantumShield,
  audit: galaxiaAudit,
  issuance: galaxiaIssuance
} = integrationClients;

// Export configuration
export default galaxiaConfig;

