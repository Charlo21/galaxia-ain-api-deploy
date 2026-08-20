# Galaxia AI Network API Server

Production-ready API server for the decentralized AI inference network.

## Features

- ✅ Node registration and health monitoring
- ✅ Smart task distribution with redundancy
- ✅ AI inference API (Llama 3, Stable Diffusion, Whisper)
- ✅ Result verification with consensus mechanism
- ✅ Token payment system
- ✅ Security: JWT auth, rate limiting, Docker sandboxing
- ✅ Admin dashboard endpoints

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Docker (for AI model containers)
- Redis (optional, for caching)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up database:**
   ```bash
   # Create database
   createdb galaxia

   # Run migrations
   psql -U postgres -d galaxia -f database/schema.sql
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Start with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

   Or run manually:
   ```bash
   npm run dev
   ```

### Build AI Model Docker Images

```bash
# Build Llama 3 8B image
cd docker/llama-3-8b
docker build -t galaxia-llama-3-8b:latest .

# Build Stable Diffusion image
cd ../stable-diffusion
docker build -t galaxia-stable-diffusion:latest .

# Build Whisper image
cd ../whisper
docker build -t galaxia-whisper:latest .
```

## API Endpoints

### Node Endpoints

- `POST /v1/nodes/register` - Register a new node
- `POST /v1/nodes/heartbeat` - Update node health
- `POST /v1/nodes/tasks/:taskId/complete` - Report task completion
- `POST /v1/nodes/tasks/:taskId/fail` - Report task failure

### Developer API

- `POST /v1/inference` - Run AI inference
- `GET /v1/tasks/:taskId` - Get task status
- `GET /v1/models` - List available models
- `POST /v1/api-keys` - Generate API key

### Admin Endpoints

- `GET /v1/admin/nodes` - List all nodes
- `GET /v1/admin/stats` - Network statistics

## Example Usage

### Register a Node

```bash
curl -X POST http://localhost:3000/v1/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "node-001",
    "wallet_address": "0x123...",
    "capabilities": {
      "cpu_cores": 4,
      "gpu": false,
      "ram_gb": 8,
      "models": ["llama-3-8b", "whisper"]
    }
  }'
```

### Run Inference

```bash
curl -X POST http://localhost:3000/v1/inference \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "model": "llama-3-8b",
    "input": "What is artificial intelligence?",
    "priority": "standard"
  }'
```

### Check Task Status

```bash
curl http://localhost:3000/v1/tasks/{task_id} \
  -H "X-API-Key: your-api-key"
```

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│  API Server │────▶│  PostgreSQL  │
└──────┬──────┘     └──────────────┘
       │
       ├──▶ Task Distribution Engine
       │
       ├──▶ Result Verification
       │
       └──▶ Docker Containers (AI Models)
```

## Database Schema

See `database/schema.sql` for complete schema.

Key tables:
- `nodes` - Registered compute nodes
- `tasks` - Inference tasks
- `task_results` - Results from each node
- `consensus_results` - Verified consensus results
- `api_keys` - Developer API keys
- `users` - User accounts and balances
- `token_transactions` - Payment history

## Security

- **API Key Authentication** - All developer endpoints require API key
- **Rate Limiting** - 100 requests/minute per API key
- **Docker Sandboxing** - AI inference runs in isolated containers
- **Input Validation** - Malicious content detection
- **Resource Limits** - 4GB RAM, 2 CPU cores, 30s timeout per task

## Performance Targets

- Task assignment: <100ms
- Average inference latency: <3s (LLM), <8s (image), <2s (audio)
- Task success rate: >95%
- Network uptime: >99%

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Lint code
npm run lint
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure secure database credentials
3. Set up SSL/TLS certificates
4. Configure reverse proxy (nginx)
5. Set up monitoring and logging
6. Run database migrations
7. Build and deploy Docker containers

## License

MIT

