# Galaxia API Server - Production Deployment Guide

Complete guide for deploying the Galaxia API Server to production.

## Prerequisites

- **Server**: Ubuntu 20.04+ or similar Linux distribution
- **Node.js**: 18+ (use nvm for version management)
- **PostgreSQL**: 15+
- **Docker**: 20.10+ (for AI model containers)
- **Nginx**: For reverse proxy and SSL
- **SSL Certificate**: Let's Encrypt or commercial

## Step 1: Server Setup

### Initial Server Configuration

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Nginx
sudo apt install -y nginx
```

## Step 2: Database Setup

```bash
# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE galaxia;
CREATE USER galaxia_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE galaxia TO galaxia_user;
\q
EOF

# Run schema
psql -U galaxia_user -d galaxia -h localhost -f database/schema.sql
```

## Step 3: Application Deployment

### Clone and Build

```bash
# Clone repository
git clone https://github.com/your-org/galaxia-ai.git
cd galaxia-ai/backend/api-server

# Install dependencies
npm ci --production

# Build TypeScript
npm run build

# Create necessary directories
mkdir -p logs temp
```

### Environment Configuration

```bash
# Create production .env
cat > .env << EOF
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

DB_HOST=localhost
DB_PORT=5432
DB_NAME=galaxia
DB_USER=galaxia_user
DB_PASSWORD=your_secure_password

JWT_SECRET=$(openssl rand -hex 32)
API_RATE_LIMIT=100

DOCKER_NETWORK=galaxia-network
EOF

# Secure .env file
chmod 600 .env
```

## Step 4: Process Management (PM2)

```bash
# Install PM2
sudo npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'galaxia-api',
    script: 'dist/index.js',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G'
  }]
};
EOF

# Start application
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Step 5: Nginx Configuration

```bash
# Create Nginx config
sudo tee /etc/nginx/sites-available/galaxia-api << EOF
upstream galaxia_api {
    least_conn;
    server localhost:3000;
    server localhost:3001;
}

server {
    listen 80;
    server_name api.galaxia.ai;

    # Redirect to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.galaxia.ai;

    ssl_certificate /etc/letsencrypt/live/api.galaxia.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.galaxia.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    client_max_body_size 50M;

    location / {
        proxy_pass http://galaxia_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/galaxia-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Step 6: SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d api.galaxia.ai

# Auto-renewal is set up automatically
```

## Step 7: Docker Images for AI Models

```bash
# Build model images
cd docker

# Llama 3 8B
cd llama-3-8b
docker build -t galaxia-llama-3-8b:latest .

# Stable Diffusion
cd ../stable-diffusion
docker build -t galaxia-stable-diffusion:latest .

# Whisper
cd ../whisper
docker build -t galaxia-whisper:latest .
```

## Step 8: Firewall Configuration

```bash
# Configure UFW
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Step 9: Monitoring & Logging

### Setup Log Rotation

```bash
sudo tee /etc/logrotate.d/galaxia-api << EOF
/path/to/galaxia-ai/backend/api-server/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 galaxia galaxia
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
```

### Setup Monitoring (Optional)

```bash
# Install monitoring tools
sudo apt install -y prometheus-node-exporter

# Or use PM2 monitoring
pm2 install pm2-logrotate
```

## Step 10: Database Backups

```bash
# Create backup script
cat > /usr/local/bin/backup-galaxia-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/galaxia"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

pg_dump -U galaxia_user -h localhost galaxia | gzip > $BACKUP_DIR/galaxia_$DATE.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "galaxia_*.sql.gz" -mtime +7 -delete
EOF

chmod +x /usr/local/bin/backup-galaxia-db.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-galaxia-db.sh") | crontab -
```

## Step 11: Health Checks

```bash
# Create health check script
cat > /usr/local/bin/check-galaxia-health.sh << 'EOF'
#!/bin/bash
HEALTH_URL="https://api.galaxia.ai/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ "$RESPONSE" != "200" ]; then
    echo "Health check failed: $RESPONSE"
    # Restart service
    pm2 restart galaxia-api
    # Send alert (configure your alerting system)
fi
EOF

chmod +x /usr/local/bin/check-galaxia-health.sh

# Add to crontab (every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/check-galaxia-health.sh") | crontab -
```

## Step 12: Performance Tuning

### PostgreSQL Tuning

Edit `/etc/postgresql/15/main/postgresql.conf`:

```conf
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 4MB
min_wal_size = 1GB
max_wal_size = 4GB
```

Restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### Node.js Tuning

Set in `.env`:
```
NODE_OPTIONS=--max-old-space-size=2048
```

## Verification

```bash
# Check API is running
curl https://api.galaxia.ai/health

# Check PM2 status
pm2 status

# Check Nginx status
sudo systemctl status nginx

# Check database connection
psql -U galaxia_user -d galaxia -c "SELECT COUNT(*) FROM nodes;"
```

## Scaling

### Horizontal Scaling

1. Add more application servers behind load balancer
2. Use shared PostgreSQL database
3. Use Redis for session/cache sharing

### Vertical Scaling

1. Increase PM2 instances: `instances: 'max'`
2. Increase PostgreSQL `shared_buffers`
3. Add more CPU/RAM to server

## Troubleshooting

### Check Logs

```bash
# Application logs
pm2 logs galaxia-api

# Nginx logs
sudo tail -f /var/log/nginx/error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-15-main.log
```

### Common Issues

1. **Port already in use**: Change PORT in .env or kill process
2. **Database connection failed**: Check credentials and PostgreSQL status
3. **Docker containers fail**: Check Docker daemon and image availability
4. **High memory usage**: Reduce PM2 instances or increase server RAM

## Security Checklist

- [ ] SSL/TLS enabled
- [ ] Firewall configured
- [ ] Database user has limited privileges
- [ ] .env file secured (chmod 600)
- [ ] Regular security updates
- [ ] Rate limiting enabled
- [ ] Input validation active
- [ ] Docker containers isolated
- [ ] Backups configured
- [ ] Monitoring in place

## Support

For issues or questions:
- **GitHub Issues**: https://github.com/your-org/galaxia-ai/issues
- **Documentation**: https://docs.galaxia.ai
- **Email**: support@galaxia.ai

