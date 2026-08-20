#!/bin/bash

# Galaxia AI Network - Demo Script
# Shows the complete workflow in action

API_URL="${API_URL:-http://localhost:3000}"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Galaxia AI Network - Demo Script${NC}"
echo "=================================="
echo ""

# Step 1: Health Check
echo -e "${YELLOW}Step 1: Health Check${NC}"
curl -s "$API_URL/health" | jq '.'
echo ""

# Step 2: Register Node
echo -e "${YELLOW}Step 2: Register Compute Node${NC}"
NODE_RESPONSE=$(curl -s -X POST "$API_URL/v1/nodes/register" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "demo-node-001",
    "wallet_address": "0xdemo1234567890abcdef",
    "capabilities": {
      "cpu_cores": 8,
      "gpu": true,
      "ram_gb": 16,
      "models": ["llama-3-8b", "stable-diffusion", "whisper"]
    }
  }')

echo "$NODE_RESPONSE" | jq '.'
NODE_ID=$(echo "$NODE_RESPONSE" | jq -r '.node.id')
echo -e "${GREEN}✅ Node registered: $NODE_ID${NC}"
echo ""

# Step 3: Generate API Key
echo -e "${YELLOW}Step 3: Generate API Key${NC}"
API_KEY_RESPONSE=$(curl -s -X POST "$API_URL/v1/api-keys" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo-user-001",
    "name": "Demo API Key"
  }')

echo "$API_KEY_RESPONSE" | jq '.'
API_KEY=$(echo "$API_KEY_RESPONSE" | jq -r '.api_key')
echo -e "${GREEN}✅ API Key generated${NC}"
echo ""

# Step 4: List Available Models
echo -e "${YELLOW}Step 4: List Available Models${NC}"
curl -s "$API_URL/v1/models" | jq '.models[] | {id, name, type, pricing}'
echo ""

# Step 5: Run Text Inference (Llama 3)
echo -e "${YELLOW}Step 5: Run Text Inference (Llama 3 8B)${NC}"
TASK_RESPONSE=$(curl -s -X POST "$API_URL/v1/inference" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "model": "llama-3-8b",
    "input": "Explain quantum computing in one sentence.",
    "priority": "standard"
  }')

echo "$TASK_RESPONSE" | jq '.'
TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task_id')
echo -e "${GREEN}✅ Task created: $TASK_ID${NC}"
echo ""

# Step 6: Check Task Status
echo -e "${YELLOW}Step 6: Check Task Status${NC}"
sleep 2
TASK_STATUS=$(curl -s "$API_URL/v1/tasks/$TASK_ID" \
  -H "X-API-Key: $API_KEY")

echo "$TASK_STATUS" | jq '.'
echo ""

# Step 7: Show Network Stats
echo -e "${YELLOW}Step 7: Network Statistics${NC}"
curl -s "$API_URL/v1/admin/stats" | jq '.'
echo ""

# Step 8: Show All Nodes
echo -e "${YELLOW}Step 8: Registered Nodes${NC}"
curl -s "$API_URL/v1/admin/nodes" | jq '.nodes[] | {device_id, status, reputation, tasks_completed}'
echo ""

echo -e "${GREEN}✅ Demo completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Check admin dashboard at http://localhost:5173"
echo "2. Run load test: npm run test:load"
echo "3. View metrics: curl $API_URL/metrics"

