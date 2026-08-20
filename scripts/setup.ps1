# Galaxia API Server Setup Script (Windows PowerShell)

Write-Host "🚀 Galaxia API Server Setup" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node -v
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is required but not installed." -ForegroundColor Red
    Write-Host "   Download from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check PostgreSQL
try {
    $pgVersion = psql --version
    Write-Host "✅ PostgreSQL found: $pgVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ PostgreSQL is required but not installed." -ForegroundColor Red
    Write-Host "   Download from: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
    exit 1
}

# Check Docker
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker found: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Docker is recommended but not installed." -ForegroundColor Yellow
    Write-Host "   AI models won't work without it." -ForegroundColor Yellow
}

Write-Host ""

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Setup database
Write-Host "Setting up database..." -ForegroundColor Yellow

$dbName = Read-Host "Database name [galaxia]"
if ([string]::IsNullOrWhiteSpace($dbName)) {
    $dbName = "galaxia"
}

$dbUser = Read-Host "Database user [postgres]"
if ([string]::IsNullOrWhiteSpace($dbUser)) {
    $dbUser = "postgres"
}

$dbPassword = Read-Host "Database password" -AsSecureString
$dbPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword)
)

# Create database
Write-Host "Creating database..." -ForegroundColor Yellow
$env:PGPASSWORD = $dbPasswordPlain
psql -U $dbUser -h localhost -c "CREATE DATABASE $dbName;" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Database may already exist, continuing..." -ForegroundColor Yellow
}

# Run schema
Write-Host "Running database schema..." -ForegroundColor Yellow
psql -U $dbUser -h localhost -d $dbName -f database/schema.sql
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to run schema" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Database setup complete" -ForegroundColor Green
Write-Host ""

# Create .env file
Write-Host "Creating .env file..." -ForegroundColor Yellow
if (-not (Test-Path .env)) {
    # Generate JWT secret
    $jwtSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
    
    $envContent = @"
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$dbName
DB_USER=$dbUser
DB_PASSWORD=$dbPasswordPlain

# Server Configuration
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Security
JWT_SECRET=$jwtSecret
API_RATE_LIMIT=100

# Docker Configuration
DOCKER_NETWORK=galaxia-network
"@
    
    $envContent | Out-File -FilePath .env -Encoding utf8
    Write-Host "✅ .env file created" -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file already exists, skipping..." -ForegroundColor Yellow
}
Write-Host ""

# Build Docker images
$buildDocker = Read-Host "Build AI model Docker images? (y/n) [y]"
if ([string]::IsNullOrWhiteSpace($buildDocker)) {
    $buildDocker = "y"
}

if ($buildDocker -eq "y" -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Building Docker images..." -ForegroundColor Yellow
    Write-Host "This may take a while (downloading models)..." -ForegroundColor Yellow
    
    Push-Location docker/llama-3-8b
    docker build -t galaxia-llama-3-8b:latest .
    Pop-Location
    
    Push-Location docker/stable-diffusion
    docker build -t galaxia-stable-diffusion:latest .
    Pop-Location
    
    Push-Location docker/whisper
    docker build -t galaxia-whisper:latest .
    Pop-Location
    
    Write-Host "✅ Docker images built" -ForegroundColor Green
} else {
    Write-Host "⚠️  Skipping Docker image builds" -ForegroundColor Yellow
}
Write-Host ""

# Create directories
New-Item -ItemType Directory -Force -Path logs | Out-Null
New-Item -ItemType Directory -Force -Path temp | Out-Null

Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Review .env file and adjust settings if needed"
Write-Host "2. Start the server: npm run dev"
Write-Host "3. Or use Docker Compose: docker-compose up -d"
Write-Host ""
Write-Host "API will be available at: http://localhost:3000" -ForegroundColor Green
Write-Host "Health check: http://localhost:3000/health" -ForegroundColor Green

