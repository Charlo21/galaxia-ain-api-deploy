/**
 * Galaxia Ecosystem Integration Clients
 * Unified export for all new application clients
 */

import { GalaxiaOracleClient } from './oracleClient';
import { GalaxiaClearingClient } from './clearingClient';
import { ConstellationL1Client } from './constellationL1Client';
import { NebulaStudioClient } from './nebulaStudioClient';
import { BitcoinQuantumShieldClient } from './bitcoinQuantumShieldClient';
import { GalaxiaAuditClient } from './auditClient';
import { GalaxiaIssuanceClient } from './issuanceClient';

export { GalaxiaOracleClient } from './oracleClient';
export type { OracleDataFeed, OracleSubscription } from './oracleClient';

export { GalaxiaClearingClient } from './clearingClient';
export type { ClearingTransaction, ClearingResult, NettingResult } from './clearingClient';

export { ConstellationL1Client } from './constellationL1Client';
export type {
  ConstellationTransaction,
  TransactionResult,
  BlockInfo,
  SmartContractCall,
  ContractResult
} from './constellationL1Client';

export { NebulaStudioClient } from './nebulaStudioClient';
export type {
  WhiteLabelConfig,
  WhiteLabelDeployment,
  SDKConfig
} from './nebulaStudioClient';

export { BitcoinQuantumShieldClient } from './bitcoinQuantumShieldClient';
export type {
  BitcoinTransaction,
  ProtectedTransaction,
  QuantumSafeAddress,
  MultiSigConfig
} from './bitcoinQuantumShieldClient';

export { GalaxiaAuditClient } from './auditClient';
export type {
  AuditRequest,
  AuditStatus,
  AuditFinding,
  AuditReport,
  MonitoringConfig
} from './auditClient';

export { GalaxiaIssuanceClient } from './issuanceClient';
export type {
  OfferingRequest,
  Offering,
  AccreditationRequest,
  AccreditationStatus,
  TokenMintRequest,
  TokenHolding,
  CapTable,
  FilingRequest,
  FilingStatus
} from './issuanceClient';

/**
 * Initialize all integration clients with default configuration
 */
export function initializeIntegrationClients() {
  const oracle = new GalaxiaOracleClient({
    quantum: true,
    compliance: ['US', 'UK', 'MiCA'],
    encryption: 'kyber'
  });

  const clearing = new GalaxiaClearingClient({
    quantum: true,
    compliance: ['US', 'UK', 'MiCA'],
    signature: 'crystals-dilithium'
  });

  const constellation = new ConstellationL1Client({
    quantum: true,
    network: process.env.CONSTELLATION_NETWORK || 'mainnet',
    rpcEndpoint: process.env.CONSTELLATION_RPC
  });

  const nebula = new NebulaStudioClient({
    quantum: true,
    whiteLabel: true
  });

  const btcShield = new BitcoinQuantumShieldClient({
    quantum: true,
    network: (process.env.BTC_NETWORK as 'mainnet' | 'testnet') || 'mainnet'
  });

  const audit = new GalaxiaAuditClient({
    quantum: true
  });

  const issuance = new GalaxiaIssuanceClient({
    quantum: true
  });

  return {
    oracle,
    clearing,
    constellation,
    nebula,
    btcShield,
    audit,
    issuance
  };
}
