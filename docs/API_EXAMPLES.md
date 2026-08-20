# API Examples - Competitive Features

Complete examples for using Galaxia AI Network's competitive features.

## Privacy-Preserving Inference

### Public (Standard)

```bash
curl -X POST http://localhost:3000/v1/inference \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "model": "llama-3-8b",
    "input": "What is artificial intelligence?",
    "priority": "standard",
    "privacy_level": "public"
  }'
```

**Response:**
```json
{
  "task_id": "uuid",
  "status": "queued",
  "nodes_assigned": 3,
  "estimated_cost": 0.01,
  "privacy_level": "public",
  "privacy_features": {},
  "platform_fee": 0
}
```

### Private (Encrypted)

```bash
curl -X POST http://localhost:3000/v1/inference \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "model": "llama-3-8b",
    "input": "Sensitive business data here",
    "priority": "standard",
    "privacy_level": "private"
  }'
```

**Response:**
```json
{
  "task_id": "uuid",
  "status": "queued",
  "nodes_assigned": 3,
  "estimated_cost": 0.01,
  "privacy_level": "private",
  "privacy_features": {
    "encrypted": true,
    "zkProof": false,
    "requiresTEE": false
  },
  "platform_fee": 0
}
```

### Confidential (Zero-Knowledge Proofs)

```bash
curl -X POST http://localhost:3000/v1/inference \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "model": "llama-3-8b",
    "input": "Highly confidential information",
    "priority": "standard",
    "privacy_level": "confidential"
  }'
```

**Response:**
```json
{
  "task_id": "uuid",
  "status": "queued",
  "nodes_assigned": 3,
  "estimated_cost": 0.01,
  "privacy_level": "confidential",
  "privacy_features": {
    "encrypted": true,
    "zkProof": true,
    "requiresTEE": true
  },
  "platform_fee": 0
}
```

## Competitive Metrics

### Get Competitive Positioning Metrics

```bash
curl http://localhost:3000/v1/competitive/metrics
```

**Response:**
```json
{
  "competitive": {
    "costSavingsVsAWS": 50.5,
    "privacyScore": 75.2,
    "decentralizationScore": 85.0,
    "providerEarningsRatio": 100.0
  },
  "token_economics": {
    "totalGXACirculating": 1250.50,
    "totalPaidToProviders": 1250.50,
    "avgProviderEarnings": 25.10,
    "governanceParticipation": 45,
    "networkEfficiency": 95.5
  },
  "payment_efficiency": {
    "totalPayments": 1000,
    "directPayments": 950,
    "platformFeeSaved": 23.75,
    "avgNodeEarnings": 25.10
  }
}
```

## Direct Payments

### Check Payment Efficiency

```bash
curl http://localhost:3000/v1/competitive/metrics
```

Look for `payment_efficiency` section:
- `directPayments`: Number of direct payments (no platform fees)
- `platformFeeSaved`: Total fees saved by using direct payments
- `avgNodeEarnings`: Average earnings per node

## Blockchain Verification

### Verify Task on Blockchain

```bash
# Get task details
curl http://localhost:3000/v1/tasks/TASK_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

Tasks are automatically recorded on blockchain. Check `blockchain_records` table or use admin endpoint.

## Complete Workflow Example

### 1. Create Privacy-Protected Task

```bash
curl -X POST http://localhost:3000/v1/inference \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "model": "llama-3-8b",
    "input": "Process this confidential data",
    "privacy_level": "confidential",
    "priority": "standard"
  }'
```

### 2. Check Task Status

```bash
curl http://localhost:3000/v1/tasks/TASK_ID \
  -H "X-API-Key: YOUR_API_KEY"
```

### 3. Verify Blockchain Record

```bash
# Use admin endpoint or database query
curl http://localhost:3000/v1/admin/stats
```

### 4. Check Competitive Metrics

```bash
curl http://localhost:3000/v1/competitive/metrics
```

## Python Example

```python
import requests

API_KEY = "your-api-key"
BASE_URL = "http://localhost:3000"

# Create privacy-protected inference
response = requests.post(
    f"{BASE_URL}/v1/inference",
    headers={
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    },
    json={
        "model": "llama-3-8b",
        "input": "Sensitive data",
        "privacy_level": "confidential",
        "priority": "standard"
    }
)

task = response.json()
print(f"Task ID: {task['task_id']}")
print(f"Privacy Level: {task['privacy_level']}")
print(f"Platform Fee: {task['platform_fee']}%")  # Should be 0

# Check competitive metrics
metrics = requests.get(f"{BASE_URL}/v1/competitive/metrics").json()
print(f"Cost Savings vs AWS: {metrics['competitive']['costSavingsVsAWS']}%")
print(f"Provider Earnings Ratio: {metrics['competitive']['providerEarningsRatio']}%")
```

## JavaScript Example

```javascript
const API_KEY = 'your-api-key';
const BASE_URL = 'http://localhost:3000';

// Create privacy-protected inference
const response = await fetch(`${BASE_URL}/v1/inference`, {
  method: 'POST',
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'llama-3-8b',
    input: 'Sensitive data',
    privacy_level: 'confidential',
    priority: 'standard'
  })
});

const task = await response.json();
console.log('Task ID:', task.task_id);
console.log('Privacy Level:', task.privacy_level);
console.log('Platform Fee:', task.platform_fee); // 0

// Get competitive metrics
const metricsResponse = await fetch(`${BASE_URL}/v1/competitive/metrics`);
const metrics = await metricsResponse.json();
console.log('Cost Savings vs AWS:', metrics.competitive.costSavingsVsAWS, '%');
console.log('Provider Earnings:', metrics.competitive.providerEarningsRatio, '%');
```

## Key Competitive Features

1. **Zero Platform Fees** - All payments go directly to providers
2. **Privacy Protection** - Three levels: public, private, confidential
3. **Blockchain Verified** - All tasks recorded on-chain
4. **Direct Payments** - User-to-node transfers with no intermediaries
5. **Competitive Pricing** - 50% cheaper than AWS

## Best Practices

1. **Use Privacy Levels Appropriately**
   - `public`: Non-sensitive data
   - `private`: Business data, personal info
   - `confidential`: Healthcare, financial, legal data

2. **Monitor Competitive Metrics**
   - Check `/v1/competitive/metrics` regularly
   - Track cost savings vs. competitors
   - Monitor provider earnings

3. **Verify Blockchain Records**
   - All tasks are automatically recorded
   - Use for audit trails
   - Verify computation integrity

4. **Optimize Costs**
   - Use direct payments when possible
   - Choose appropriate privacy level
   - Monitor token economics

