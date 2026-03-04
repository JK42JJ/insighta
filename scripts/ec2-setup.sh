#!/bin/bash
# =============================================================================
# TubeArchive - EC2 Instance Setup Script
# =============================================================================
# Run this once on a fresh Ubuntu 22.04 EC2 t2.micro instance.
# Usage: sudo bash ec2-setup.sh
# =============================================================================

set -euo pipefail

echo "=== TubeArchive EC2 Setup ==="

# ---------------------------------------------------------------------------
# 1. System Updates
# ---------------------------------------------------------------------------
echo "[1/7] Updating system packages..."
apt-get update && apt-get upgrade -y

# ---------------------------------------------------------------------------
# 2. Install Docker
# ---------------------------------------------------------------------------
echo "[2/7] Installing Docker..."
apt-get install -y ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group
usermod -aG docker ubuntu

echo "Docker version: $(docker --version)"

# ---------------------------------------------------------------------------
# 3. Install Nginx
# ---------------------------------------------------------------------------
echo "[3/7] Installing Nginx..."
apt-get install -y nginx

systemctl enable nginx
systemctl start nginx

# ---------------------------------------------------------------------------
# 4. Install Certbot (Let's Encrypt)
# ---------------------------------------------------------------------------
echo "[4/7] Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# ---------------------------------------------------------------------------
# 5. Setup Swap (t2.micro has only 1GB RAM)
# ---------------------------------------------------------------------------
echo "[5/7] Setting up 2GB swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Swap enabled: $(swapon --show)"
else
    echo "Swap already exists"
fi

# Optimize swap usage for low-memory instance
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf

# ---------------------------------------------------------------------------
# 6. Create application directory
# ---------------------------------------------------------------------------
echo "[6/7] Creating application directory..."
mkdir -p /home/ubuntu/tubearchive
chown ubuntu:ubuntu /home/ubuntu/tubearchive

# Create certbot webroot
mkdir -p /var/www/certbot

# ---------------------------------------------------------------------------
# 7. Firewall (UFW)
# ---------------------------------------------------------------------------
echo "[7/7] Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy docker-compose.prod.yml to ~/tubearchive/"
echo "  2. Copy .env.production to ~/tubearchive/"
echo "  3. Copy deploy/nginx/tubearchive.conf to /etc/nginx/sites-available/"
echo "  4. Enable site: sudo ln -s /etc/nginx/sites-available/tubearchive.conf /etc/nginx/sites-enabled/"
echo "  5. Remove default: sudo rm /etc/nginx/sites-enabled/default"
echo "  6. Get SSL certificate:"
echo "     sudo certbot --nginx -d insighta.one -d www.insighta.one"
echo "  7. Test nginx: sudo nginx -t && sudo systemctl reload nginx"
echo "  8. Login to GHCR: echo \$GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin"
echo "  9. Start services: cd ~/tubearchive && docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "Auto-renewal cron (already set by certbot):"
echo "  sudo certbot renew --dry-run"
