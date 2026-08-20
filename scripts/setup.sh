#!/bin/bash

# Galaxia API Server Setup Script

set -e

echo "🚀 Galaxia API Server Setup"
echo "=========================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "❌ PostgreSQL is required but not installed. Aborting." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "⚠️  Docker is recommended but not installed. AI models won't work without it."; }

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ is required. You have $(node -v). Aborting." >&2
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Setup database
echo "Setting up database..."
read -p "Database name [galaxia]: " DB_NAME
DB_NAME=${DB_NAME:-galaxia}

read -p "Database user [postgres]: " DB_USER
DB_USER=${DB_USER:-postgres}

read -p "Database password: " -s DB_PASSWORD
echo ""

# Create database
echo "Creating database..."
PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h localhost -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "Database already exists"

# Run schema
echo "Running database schema..."
PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h localhost -d $DB_NAME -f database/schema.sql
echo "✅ Database setup complete"
echo ""

# Create .env file
echo "Creating .env file..."
if [ ! -f .env ]; then
    cat > .env << EOF
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Security
JWT_SECRET=$(openssl rand -hex 32)
API_RATE_LIMIT=100

# Docker Configuration
DOCKER_NETWORK=galaxia-network
EOF
    echo "✅ .env file created"
else
    echo "⚠️  .env file already exists, skipping..."
fi
echo ""

# Build Docker images
read -p "Build AI model Docker images? (y/n) [y]: " BUILD_DOCKER
BUILD_DOCKER=${BUILD_DOCKER:-y}

if [ "$BUILD_DOCKER" = "y" ] && command -v docker >/dev/null 2>&1; then
    echo "Building Docker images..."
    echo "This may take a while (downloading models)..."
    
    cd docker/llama-3-8b
    docker build -t galaxia-llama-3-8b:latest . || echo "⚠️  Llama 3 build failed"
    
    cd ../stable-diffusion
    docker build -t galaxia-stable-diffusion:latest . || echo "⚠️  Stable Diffusion build failed"
    
    cd ../whisper
    docker build -t galaxia-whisper:latest . || echo "⚠️  Whisper build failed"
    
    cd ../..
    echo "✅ Docker images built"
else
    echo "⚠️  Skipping Docker image builds"
fi
echo ""

# Create logs directory
mkdir -p logs
mkdir -p temp

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Review .env file and adjust settings if needed"
echo "2. Start the server: npm run dev"
echo "3. Or use Docker Compose: docker-compose up -d"
echo ""
echo "API will be available at: http://localhost:3000"
echo "Health check: http://localhost:3000/health"

