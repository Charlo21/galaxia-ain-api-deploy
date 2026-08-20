# Galaxia AI Network API Documentation

Complete API reference for the Galaxia decentralized AI inference network.

## Base URL

```
https://api.galaxia.ai
```

## Authentication

All developer endpoints require an API key in the header:

```
X-API-Key: galx_your_api_key_here
```

## Endpoints

### Inference API

#### POST /v1/inference

Run AI inference on the decentralized network.

**Request:**
```json
{
  "model": "llama-3-8b" | "stable-diffusion" | "whisper",
  "input": "text or base64 encoded image/audio",
  "priority": "standard" | "fast",
  "region": "auto" | "us-east" | "eu-west" | "asia"
}
```

**Response:**
```json
{
  "task_id": "uuid",
  "status": "queued",
  "nodes_assigned": 3,
  "estimated_cost": 0.01,
  "request_id": "uuid"
}
```

**Example:**
```bash
curl -X POST https://api.galaxia.ai/v1/inference \
  -H "Content-Type: application/json" \
  -H "X-API-Key: galx_..." \
  -d '{
    "model": "llama-3-8b",
    "input": "Explain quantum computing in simple terms",
    "priority": "standard"
  }'
```

#### GET /v1/tasks/:taskId

Get task status and results.

**Response:**
```json
{
  "task_id": "uuid",
  "status": "completed",
  "model": "llama-3-8b",
  "priority": "standard",
  "nodes_used": 3,
  "latency_ms": 245,
  "cost_tokens": 0.01,
  "result": "Quantum computing uses quantum mechanics...",
  "created_at": "2024-01-01T00:00:00Z",
  "completed_at": "2024-01-01T00:00:05Z"
}
```

#### GET /v1/models

List available models and pricing.

**Response:**
```json
{
  "models": [
    {
      "id": "llama-3-8b",
      "name": "Llama 3 8B",
      "type": "llm",
      "pricing": {
        "per_1k_tokens": 0.01
      },
      "requires_gpu": false
    },
    {
      "id": "stable-diffusion",
      "name": "Stable Diffusion",
      "type": "image",
      "pricing": {
        "per_image": 0.05
      },
      "requires_gpu": true
    },
    {
      "id": "whisper",
      "name": "Whisper Speech-to-Text",
      "type": "audio",
      "pricing": {
        "per_minute": 0.02
      },
      "requires_gpu": false
    }
  ]
}
```

### Node Endpoints

#### POST /v1/nodes/register

Register a new compute node.

**Request:**
```json
{
  "device_id": "unique-device-id",
  "wallet_address": "0x...",
  "capabilities": {
    "cpu_cores": 4,
    "gpu": false,
    "ram_gb": 8,
    "models": ["llama-3-8b", "whisper"]
  },
  "location": {
    "country": "US",
    "region": "us-east",
    "city": "New York"
  }
}
```

#### POST /v1/nodes/heartbeat

Update node health status.

**Request:**
```json
{
  "device_id": "unique-device-id",
  "cpu_usage": 45.2,
  "memory_usage": 62.1,
  "gpu_usage": 0,
  "active_tasks": 1,
  "response_time_ms": 120
}
```

### Admin Endpoints

#### GET /v1/admin/nodes

List all registered nodes (admin only).

#### GET /v1/admin/stats

Get network statistics.

**Response:**
```json
{
  "nodes": {
    "total": 50,
    "online": 45,
    "avg_reputation": 72.5
  },
  "tasks": {
    "total": 1000,
    "completed": 950,
    "avg_latency_ms": 245
  },
  "earnings": {
    "total_paid": 125.50
  }
}
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "request_id": "uuid"
}
```

**Status Codes:**
- `400` - Bad Request
- `401` - Unauthorized (invalid API key)
- `402` - Payment Required (insufficient balance)
- `404` - Not Found
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error

## Rate Limits

- **Standard**: 100 requests/minute per API key
- **Fast Priority**: Same limits, but 2x cost

## Pricing

- **Text Generation (Llama 3)**: 0.01 tokens per 1K tokens
- **Image Generation (Stable Diffusion)**: 0.05 tokens per image
- **Audio Transcription (Whisper)**: 0.02 tokens per minute
- **Fast Priority**: 2x multiplier

## Webhooks (Coming Soon)

Subscribe to task completion events:

```
POST /v1/webhooks
{
  "url": "https://your-app.com/webhook",
  "events": ["task.completed", "task.failed"]
}
```

## SDKs

- **JavaScript/TypeScript**: `npm install @galaxia/sdk`
- **Python**: `pip install galaxia-sdk`
- **Go**: `go get github.com/galaxia/sdk-go`

## Support

- **Documentation**: https://docs.galaxia.ai
- **Discord**: https://discord.gg/galaxia
- **Email**: support@galaxia.ai

