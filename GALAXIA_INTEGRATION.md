# Galaxia Ecosystem Integration Guide

## Overview

The Galaxia AI Infrastructure Network is now fully integrated with the Galaxia ecosystem, including:

- **Galaxia ID** - Unified authentication
- **GXA Coin** - Primary token for payments
- **Galaxia Quantum Security Network** - Post-quantum cryptographic security

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Galaxia Ecosystem Configuration
GALAXIA_API_BASE_URL=https://api.galaxia.io
GALAXIA_APP_NAME=galaxia-ai-network
GALAXIA_APP_VERSION=1.0.0
GALAXIA_CHAIN_ID=galaxia-mainnet
GALAXIA_API_KEY=your-galaxia-api-key

# Quantum Security
QUANTUM_KEY_ENCRYPTION_KEY=your-encryption-key-32-bytes-hex
```

## Authentication

### Using Galaxia ID

The API now supports Galaxia ID authentication in addition to API keys:

```bash
# Authenticate with Galaxia ID
curl -X POST https://api.galaxia.io/v1/auth/wallet \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x...",
    "walletType": "near",
    "signature": "...",
    "message": "Sign in to Galaxia AI Network"
  }'

# Use token in requests
curl -X POST http://localhost:3000/v1/inference \
  -H "Authorization: Bearer YOUR_GALAXIA_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3-8b",
    "input": "Hello"
  }'
```

### Fallback to API Keys

If Galaxia ID authentication fails, the system automatically falls back to API key authentication for graceful degradation.

## GXA Coin Integration

### Payment Processing

The payment system now integrates with GXA Coin:

```typescript
// Get GXA balance
const balance = await gxaCoinService.getBalance(walletAddress);

// Transfer GXA
const transaction = await gxaCoinService.transfer(
  fromAddress,
  toAddress,
  amount,
  signature
);
```

### Automatic Balance Checking

When processing payments, the system:
1. Checks internal token balance
2. If wallet address available, also checks GXA Coin balance
3. Uses combined balance for payment processing

## Quantum Security

### Post-Quantum Cryptography

The system implements:
- **CRYSTALS-Kyber** - Key encapsulation
- **CRYSTALS-Dilithium** - Digital signatures
- **SPHINCS+** - Backup signature scheme
- **AES-256-GCM** - Symmetric encryption (quantum-resistant)

### Using Quantum Security

```typescript
// Generate quantum-resistant key pair
const keyPair = await quantumSecurityService.generateKeyPair('CRYSTALS-Kyber');

// Sign data
const signature = await quantumSecurityService.sign(data, keyPair.keyId);

// Encrypt data
const encrypted = await quantumSecurityService.encrypt(data, recipientPublicKey);
```

### API Endpoints with Quantum Security

Sensitive operations can require quantum signatures:

```bash
# Request with quantum signature
curl -X POST http://localhost:3000/v1/admin/nodes \
  -H "Authorization: Bearer TOKEN" \
  -H "X-Quantum-Signature: ..." \
  -H "X-Quantum-Public-Key: ..." \
  -H "X-Quantum-Algorithm: CRYSTALS-Dilithium" \
  -H "X-Quantum-Timestamp: 1234567890"
```

## Service Architecture

```
┌─────────────────────────────────────────┐
│     Galaxia AI Network API Server      │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Galaxia Ecosystem Service      │  │
│  │   - Unified API client           │  │
│  │   - Error handling               │  │
│  │   - Graceful degradation         │  │
│  └──────────────────────────────────┘  │
│              │                          │
│    ┌─────────┼─────────┐                │
│    │         │         │                │
│    ▼         ▼         ▼                │
│  ┌─────┐  ┌─────┐  ┌──────────┐        │
│  │Galaxia│ │GXA │  │ Quantum  │        │
│  │  ID  │ │Coin │  │ Security │        │
│  └─────┘  └─────┘  └──────────┘        │
│                                         │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│      Galaxia Ecosystem Services         │
│  - api.galaxia.io                      │
│  - Quantum Security Network            │
│  - GXA Coin Network                    │
└─────────────────────────────────────────┘
```

## Error Handling

All Galaxia integrations implement graceful degradation:

- If Galaxia ID fails → Falls back to API key auth
- If GXA balance check fails → Uses internal balance only
- If quantum security fails → Falls back to classical crypto

This ensures the system continues operating even if ecosystem services are unavailable.

## Health Checks

Check ecosystem service health:

```bash
# Check Galaxia ecosystem connectivity
curl http://localhost:3000/health

# Response includes ecosystem service status
{
  "status": "healthy",
  "database": { "connected": true },
  "galaxia": {
    "id": true,
    "gxa": true,
    "quantum": true
  }
}
```

## Migration Guide

### From API Keys to Galaxia ID

1. **Update authentication middleware**:
   ```typescript
   // Old
   app.post('/v1/inference', authenticateApiKey, ...);
   
   // New (supports both)
   app.post('/v1/inference', authenticateGalaxiaId, ...);
   ```

2. **Update frontend**:
   - Use Galaxia ID SDK for authentication
   - Store Galaxia ID tokens instead of API keys

3. **Update payment processing**:
   - Link user wallets to accounts
   - Enable GXA Coin balance checking

## Testing

### Test Galaxia Integration

```bash
# Test Galaxia ID authentication
npm test -- galaxiaId

# Test GXA Coin integration
npm test -- gxaCoin

# Test quantum security
npm test -- quantumSecurity
```

## Support

For issues with Galaxia ecosystem integration:
- **Documentation**: See `backend/api-server/README.md`
- **Galaxia API Docs**: https://docs.galaxia.io
- **Support**: support@galaxia.io

