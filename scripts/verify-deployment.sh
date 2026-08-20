#!/bin/bash

# Deployment Verification Script
# Verifies all competitive features are working correctly

set -e

API_URL="${API_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-test-key}"

echo "🔍 Verifying Galaxia AI Network Deployment"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test counters
PASSED=0
FAILED=0

test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -n "Testing $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$API_URL$endpoint" \
            -H "X-API-Key: $API_KEY" 2>/dev/null || echo -e "\n000")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "X-API-Key: $API_KEY" \
            -d "$data" 2>/dev/null || echo -e "\n000")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASSED${NC} (HTTP $http_code)"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} (HTTP $http_code)"
        echo "  Response: $body"
        ((FAILED++))
        return 1
    fi
}

# 1. Health Check
echo "1. Health Check"
test_endpoint "Health" "GET" "/health"
echo ""

# 2. Competitive Metrics
echo "2. Competitive Metrics"
test_endpoint "Competitive Metrics" "GET" "/v1/competitive/metrics"
echo ""

# 3. Models List
echo "3. Models List"
test_endpoint "Models" "GET" "/v1/models"
echo ""

# 4. Privacy Features
echo "4. Privacy Features"
echo "  Testing public privacy level..."
test_endpoint "Public Privacy" "POST" "/v1/inference" \
    '{"model":"llama-3-8b","input":"test","privacy_level":"public"}'

echo "  Testing private privacy level..."
test_endpoint "Private Privacy" "POST" "/v1/inference" \
    '{"model":"llama-3-8b","input":"test","privacy_level":"private"}'

echo "  Testing confidential privacy level..."
test_endpoint "Confidential Privacy" "POST" "/v1/inference" \
    '{"model":"llama-3-8b","input":"test","privacy_level":"confidential"}'
echo ""

# 5. Zero Platform Fee Verification
echo "5. Platform Fee Verification"
response=$(curl -s -X POST "$API_URL/v1/inference" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d '{"model":"llama-3-8b","input":"test"}')

platform_fee=$(echo "$response" | grep -o '"platform_fee":[0-9]*' | cut -d':' -f2)

if [ "$platform_fee" = "0" ]; then
    echo -e "${GREEN}✓ Platform fee is 0%${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Platform fee is not 0% (found: $platform_fee%)${NC}"
    ((FAILED++))
fi
echo ""

# 6. Database Tables
echo "6. Database Tables Verification"
echo "  Checking direct_payments table..."
# This would require database access - skip for now
echo -e "${YELLOW}⚠ Manual verification required${NC}"
echo ""

# Summary
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi

