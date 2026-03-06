#!/bin/bash
# =============================================================================
# ${app_name} - EC2 Instance Setup (Terraform cloud-init)
# =============================================================================
# Auto-runs on first boot. Changes here only apply to NEW instances.
# =============================================================================

set -euo pipefail

echo "=== ${app_name} EC2 Setup ==="

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
# 5. Setup Swap
# ---------------------------------------------------------------------------
echo "[5/7] Setting up ${swap_size} swap..."
if [ ! -f /swapfile ]; then
    fallocate -l ${swap_size} /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Swap enabled: $(swapon --show)"
else
    echo "Swap already exists"
fi

sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf

# ---------------------------------------------------------------------------
# 6. Create application directory
# ---------------------------------------------------------------------------
echo "[6/7] Creating application directory..."
mkdir -p ${app_dir}
chown ubuntu:ubuntu ${app_dir}
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
echo "  1. Copy docker-compose.prod.yml to ${app_dir}/"
echo "  2. Copy .env to ${app_dir}/"
echo "  3. Configure Nginx for ${domain}"
echo "  4. Get SSL: sudo certbot --nginx -d ${domain} -d www.${domain}"
echo "  5. Start services: cd ${app_dir} && docker compose -f docker-compose.prod.yml up -d"
