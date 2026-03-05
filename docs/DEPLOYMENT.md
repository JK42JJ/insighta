# Insighta Deployment Guide

This document covers the complete process for deploying Insighta to production on AWS EC2 with Supabase Cloud, GHCR, and GitHub Actions CI/CD.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Phase 1: External Resources Setup](#phase-1-external-resources-setup)
  - [1-1. Supabase Cloud Project](#1-1-supabase-cloud-project)
  - [1-2. AWS EC2 Instance](#1-2-aws-ec2-instance)
  - [1-3. Domain and DNS](#1-3-domain-and-dns)
  - [1-4. GitHub Repository](#1-4-github-repository)
  - [1-5. Generate Secrets](#1-5-generate-secrets)
- [Phase 2: EC2 Server Initialization](#phase-2-ec2-server-initialization)
  - [2-1. SSH Access](#2-1-ssh-access)
  - [2-2. Run Setup Script](#2-2-run-setup-script)
  - [2-3. Directory Permissions](#2-3-directory-permissions)
- [Phase 3: SSL Certificate](#phase-3-ssl-certificate)
  - [3-1. Verify DNS Propagation](#3-1-verify-dns-propagation)
  - [3-2. Deploy Nginx Configuration](#3-2-deploy-nginx-configuration)
  - [3-3. Issue SSL Certificate](#3-3-issue-ssl-certificate)
- [Phase 4: Docker Compose and Environment Variables](#phase-4-docker-compose-and-environment-variables)
  - [4-1. Transfer docker-compose.prod.yml](#4-1-transfer-docker-composeprodyml)
  - [4-2. Create .env File](#4-2-create-env-file)
- [Phase 5: GHCR Login](#phase-5-ghcr-login)
- [Phase 6: GitHub Secrets](#phase-6-github-secrets)
- [Phase 7: First Deployment](#phase-7-first-deployment)
- [Phase 8: Verification](#phase-8-verification)
- [Phase 9: Google OAuth Setup](#phase-9-google-oauth-setup)
- [Troubleshooting](#troubleshooting)
- [Manual Rollback](#manual-rollback)
- [Cost Summary](#cost-summary)
- [Related Files](#related-files)

---

## Architecture Overview

```
[Developer] -> git push main -> [GitHub Actions]
                                    |-- CI (lint, typecheck, test, build)
                                    |-- Docker Build -> GHCR
                                    |-- DB Migration (Prisma)
                                    `-- SSH Deploy -> EC2

[insighta.one] -> [Elastic IP] -> [EC2 t2.micro]
                                      |-- Nginx (SSL termination, port 443/80)
                                      |-- Docker: API (Fastify, port 3000)
                                      `-- Docker: Frontend (Nginx, port 8081)
                                            |
                                    [Supabase Cloud]
                                      |-- PostgreSQL (DB)
                                      |-- Auth (Google OAuth + Email)
                                      `-- JWT Verification
```

**Key design decisions:**

- Nginx on the EC2 host handles SSL termination and reverse proxying. Docker containers bind to `127.0.0.1` only.
- The API container exposes port 3000 and the frontend container exposes port 8081, both accessible only from localhost.
- Supabase Cloud is used for the database and authentication. No database container is run on EC2.
- Docker images are built and pushed to GHCR by GitHub Actions. EC2 only pulls and runs pre-built images.
- Prisma migrations run in GitHub Actions (not on EC2) using `DIRECT_URL` (Session Pooler, port 5432).

---

## Phase 1: External Resources Setup

### 1-1. Supabase Cloud Project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) and create a new project.
2. Set the region to **US West (Oregon)** to match the AWS EC2 region (`us-west-2`).
3. Choose a strong database password and save it.

After the project is created, collect the following values from **Settings > API**:

| Value | Location |
|---|---|
| `SUPABASE_URL` | Settings > API > Project URL |
| `SUPABASE_ANON_KEY` | Settings > API > anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings > API > service_role |
| `SUPABASE_JWT_SECRET` | Settings > API > JWT Secret > Legacy tab (HS256 shared secret) |

For database connection strings, go to **Settings > Database > Connection string**:

| Value | Location | Port |
|---|---|---|
| `DATABASE_URL` | Transaction Pooler | 6543 |
| `DIRECT_URL` | Session Pooler | 5432 |

The `DATABASE_URL` (Transaction Pooler, port 6543) is IPv4-compatible and used by the running application. The `DIRECT_URL` (Session Pooler, port 5432) is used only by Prisma migrations and cannot be replaced with the Transaction Pooler for that purpose.

The connection string format is:
```
postgresql://postgres.[ref]:[password]@aws-0-us-west-2.pooler.supabase.com:[port]/postgres
```

For `DATABASE_URL`, append `?pgbouncer=true` to the Transaction Pooler URL:
```
postgresql://postgres.[ref]:[password]@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
```

### 1-2. AWS EC2 Instance

1. Create a free-tier AWS account at [https://aws.amazon.com](https://aws.amazon.com).
2. Set the region to **us-west-2 (Oregon)** to match your Supabase project.

**Launch an EC2 instance with these settings:**

| Setting | Value |
|---|---|
| AMI | Ubuntu Server 22.04 LTS (HVM), SSD Volume Type |
| Instance type | t2.micro (Free Tier eligible) |
| Key pair | RSA, download as `.pem` format |
| Storage | 20 GiB gp2 (the default 8 GiB is insufficient for Docker) |

> Note: `t3.micro` is **not** Free Tier eligible. Use `t2.micro`.

**Security Group inbound rules:**

| Type | Port | Source |
|---|---|---|
| SSH | 22 | My IP only |
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 |

**Allocate and associate an Elastic IP:**

1. In the EC2 console, go to **Elastic IPs > Allocate Elastic IP address**.
2. Select the new allocation, then **Actions > Associate Elastic IP address**.
3. Select your instance and confirm.

The Elastic IP ensures your server address does not change when the instance is stopped and restarted.

### 1-3. Domain and DNS

1. Register a domain with a registrar of your choice (GoDaddy, Cloudflare, Namecheap, etc.).
2. Add a DNS **A record** pointing your apex domain (e.g., `insighta.one`) to your Elastic IP address.
3. Add a second **A record** (or CNAME) for `www.insighta.one` pointing to the same address.

DNS propagation typically takes a few minutes to a few hours. You must confirm propagation before issuing an SSL certificate.

### 1-4. GitHub Repository

1. Create or use an existing repository (e.g., `github.com/JK42JJ/insighta`).
2. If your local git history contains any committed secrets, go to **Settings > Security > Secret scanning > Push protection** and disable it temporarily, or use the unblock URL provided by GitHub when a push is blocked.

### 1-5. Generate Secrets

Generate a 64-character hex string for `ENCRYPTION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this value. You will need it in Phase 4 and Phase 6.

---

## Phase 2: EC2 Server Initialization

### 2-1. SSH Access

Set the correct permissions on the `.pem` file before connecting:

```bash
chmod 400 ~/Downloads/your-key.pem
```

Connect to your instance:

```bash
ssh -i ~/Downloads/your-key.pem ubuntu@<ELASTIC_IP>
```

Replace `<ELASTIC_IP>` with your allocated Elastic IP address.

### 2-2. Run Setup Script

Transfer the setup script from your local machine to the EC2 instance:

```bash
scp -i ~/Downloads/your-key.pem \
  /Users/jeonhokim/cursor/sync-youtube-playlists/scripts/ec2-setup.sh \
  ubuntu@<ELASTIC_IP>:~/
```

On EC2, run the script:

```bash
chmod +x ~/ec2-setup.sh
sudo ~/ec2-setup.sh
```

The script performs the following steps in order:

1. Updates system packages (`apt-get update && upgrade`)
2. Installs Docker CE, Docker CLI, containerd, buildx, and compose plugin
3. Adds the `ubuntu` user to the `docker` group
4. Installs Nginx and enables it as a systemd service
5. Installs Certbot and the Nginx plugin for Let's Encrypt
6. Creates a 2 GiB swap file at `/swapfile` (t2.micro has only 1 GiB RAM; swap is required for Docker builds)
7. Sets `vm.swappiness=10` to minimize swap usage under normal conditions
8. Creates `/home/ubuntu/insighta` and `/var/www/certbot`
9. Configures UFW firewall to allow SSH and `Nginx Full` (ports 80 and 443)

If a dialog appears during the upgrade asking about "Daemons using outdated libraries", press Tab to move to "Ok" and press Enter to continue.

### 2-3. Directory Permissions

After the script completes, verify the application directory is owned by the `ubuntu` user:

```bash
sudo chown ubuntu:ubuntu /opt/insighta
```

> Note: The setup script creates the directory at `/home/ubuntu/insighta`. Depending on your `docker-compose.prod.yml`, you may also use `/opt/insighta`. Confirm which path your compose file references and ensure that directory exists and has the correct ownership.

---

## Phase 3: SSL Certificate

### 3-1. Verify DNS Propagation

Before requesting a certificate, confirm that your domain resolves to the Elastic IP:

```bash
dig insighta.one +short
```

The output must be your Elastic IP address. If the IP is not shown, wait for DNS propagation to complete before proceeding.

### 3-2. Deploy Nginx Configuration

Transfer the Nginx configuration from your local machine:

```bash
scp -i ~/Downloads/your-key.pem \
  /Users/jeonhokim/cursor/sync-youtube-playlists/deploy/nginx/insighta.conf \
  ubuntu@<ELASTIC_IP>:~/
```

On EC2, install the configuration:

```bash
sudo cp ~/insighta.conf /etc/nginx/sites-available/insighta
sudo ln -s /etc/nginx/sites-available/insighta /etc/nginx/sites-enabled/insighta
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
```

The `nginx -t` command validates the configuration syntax. If it reports errors, correct the configuration before continuing.

The Nginx configuration (`deploy/nginx/insighta.conf`) handles:

- HTTP to HTTPS redirect (port 80 to 443)
- Let's Encrypt ACME challenge at `/.well-known/acme-challenge/`
- SSL with TLSv1.2 and TLSv1.3, strong cipher suite, HSTS
- Security headers (X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy)
- Gzip compression
- Rate limiting (30 req/s per IP with burst 50) on `/api/`
- Reverse proxy for `/api/` and `/health` to port 3000 (API)
- Reverse proxy for `/oauth/callback`, `/documentation`, `/api-reference` to port 3000
- Reverse proxy for `/` and static assets to port 8081 (Frontend)
- Static asset caching with 30-day expiry

### 3-3. Issue SSL Certificate

```bash
sudo certbot --nginx -d insighta.one -d www.insighta.one
```

When prompted:
- Enter your email address for renewal notifications.
- Accept the Terms of Service: `Y`
- The EFF newsletter prompt: `Y` or `N` (your preference)

Certbot will automatically modify the Nginx configuration to reference the issued certificate.

If automatic installation fails with the message "Could not automatically find a matching server block", run the following instead:

```bash
sudo certbot install --cert-name insighta.one
sudo systemctl restart nginx
```

Certbot installs a cron job (or systemd timer) for automatic certificate renewal. To verify it works:

```bash
sudo certbot renew --dry-run
```

---

## Phase 4: Docker Compose and Environment Variables

### 4-1. Transfer docker-compose.prod.yml

From your local machine:

```bash
scp -i ~/Downloads/your-key.pem \
  /Users/jeonhokim/cursor/sync-youtube-playlists/docker-compose.prod.yml \
  ubuntu@<ELASTIC_IP>:/opt/insighta/
```

The production compose file (`docker-compose.prod.yml`) runs two services:

- **api**: The Fastify backend, image `ghcr.io/jk42jj/insighta-api:latest`, bound to `127.0.0.1:3000`. Memory limit 512 MiB.
- **frontend**: The React/Vite app served by Nginx, image `ghcr.io/jk42jj/insighta-frontend:latest`, bound to `127.0.0.1:8081`. Memory limit 256 MiB.

Both services use `restart: unless-stopped`, have healthchecks, and share a `insighta-network` bridge network.

### 4-2. Create .env File

On EC2, create the environment file:

```bash
nano /opt/insighta/.env
```

Paste and fill in all values:

```env
NODE_ENV=production
API_PORT=3000
API_HOST=0.0.0.0
CORS_ORIGIN=https://insighta.one,https://www.insighta.one

SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
SUPABASE_JWT_SECRET=<jwt_secret>

DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.<ref>:<password>@aws-0-us-west-2.pooler.supabase.com:5432/postgres

YOUTUBE_API_KEY=<youtube_api_key>
YOUTUBE_CLIENT_ID=<youtube_client_id>
YOUTUBE_CLIENT_SECRET=<youtube_client_secret>
YOUTUBE_REDIRECT_URI=https://insighta.one/oauth/callback

GEMINI_API_KEY=<gemini_api_key>
GEMINI_MODEL=gemini-2.5-flash

ENCRYPTION_SECRET=<64_char_hex_string>

LOG_LEVEL=info
DAILY_QUOTA_LIMIT=10000
QUOTA_WARNING_THRESHOLD=9000

DOMAIN=insighta.one
```

Save the file with `Ctrl+O`, confirm with Enter, then exit with `Ctrl+X`.

A template for this file is available at `.env.production.example` in the repository.

---

## Phase 5: GHCR Login

GitHub Container Registry (GHCR) requires authentication to pull private images, even though the free tier is used here.

**Generate a GitHub Personal Access Token (PAT):**

1. Go to [https://github.com/settings/tokens](https://github.com/settings/tokens).
2. Click **Generate new token (classic)**.
3. Select the following scopes: `read:packages`, `write:packages`.
4. Copy the generated token.

**Log in to GHCR on EC2:**

```bash
echo "<YOUR_PAT>" | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
```

Replace `<YOUR_PAT>` with the token and `<GITHUB_USERNAME>` with your GitHub username.

This login is stored in `~/.docker/config.json` and persists across sessions. The deploy workflow authenticates using `GITHUB_TOKEN` (automatically provided by GitHub Actions), so the PAT is only needed on the EC2 instance itself.

---

## Phase 6: GitHub Secrets

Navigate to your repository on GitHub, then go to **Settings > Secrets and variables > Actions > New repository secret**.

Register all 14 secrets:

| Secret Name | Value |
|---|---|
| `EC2_HOST` | Your Elastic IP address |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Full contents of your `.pem` file (`cat ~/Downloads/your-key.pem`) |
| `DATABASE_URL` | Supabase Transaction Pooler URL (port 6543, with `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase Session Pooler URL (port 5432, no pgbouncer suffix) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase `anon public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase `service_role` key |
| `SUPABASE_JWT_SECRET` | Supabase Legacy JWT Secret (HS256) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |
| `ENCRYPTION_SECRET` | 64-character hex string generated in Phase 1-5 |
| `DOMAIN` | `insighta.one` |

When copying the SSH key (`EC2_SSH_KEY`), include the full content with the `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines.

---

## Phase 7: First Deployment

Push the code to the `main` branch to trigger the deployment pipeline:

```bash
git push origin master:main
```

GitHub Actions runs four jobs in sequence:

1. **CI Checks** (`.github/workflows/ci.yml`) - Runs in parallel:
   - `lint`: ESLint with `continue-on-error: true`
   - `typecheck`: `npx prisma generate` then `npm run typecheck`
   - `test`: `npx prisma generate` then `npm test`
   - `build-api`: Builds the TypeScript backend
   - `build-frontend`: Builds the React frontend (Vite)

2. **Build and Push Docker Images** - After CI passes:
   - Logs in to GHCR using `GITHUB_TOKEN`
   - Builds and pushes `ghcr.io/jk42jj/insighta-api` with `latest` and `<sha>` tags
   - Builds and pushes `ghcr.io/jk42jj/insighta-frontend` with `latest` and `<sha>` tags
   - Uses GitHub Actions cache (`type=gha`) to speed up subsequent builds

3. **Database Migration** - After images are pushed:
   - Runs `npx prisma migrate deploy` using `DATABASE_URL` and `DIRECT_URL` secrets
   - Uses `DIRECT_URL` (Session Pooler, port 5432) which supports DDL statements

4. **Deploy to EC2** - After migration succeeds:
   - SSH into EC2 using `appleboy/ssh-action`
   - `cd /opt/insighta`
   - Logs in to GHCR
   - Pulls the latest images
   - Runs `docker compose -f docker-compose.prod.yml up -d --remove-orphans`
   - Polls `http://localhost:3000/health` up to 6 times (60 seconds total)
   - If health checks all fail, initiates an automatic rollback
   - Prunes unused images on success

Monitor the pipeline at `https://github.com/<owner>/<repo>/actions`.

---

## Phase 8: Verification

Run these checks after the first successful deployment:

```bash
# Basic health check through Nginx and SSL
curl https://insighta.one/health

# API health endpoint
curl https://insighta.one/api/v1/health

# Confirm TLS is active
curl -vI https://insighta.one 2>&1 | grep "TLS"

# Check containers on EC2
ssh -i ~/Downloads/your-key.pem ubuntu@<ELASTIC_IP>
docker ps
docker logs insighta-api --tail 20
docker logs insighta-frontend --tail 20
```

Expected `docker ps` output shows two running containers:

```
CONTAINER ID   IMAGE                               STATUS
xxxxxxxxxxxx   ghcr.io/jk42jj/insighta-api:...    Up X minutes (healthy)
xxxxxxxxxxxx   ghcr.io/jk42jj/insighta-frontend:. Up X minutes (healthy)
```

Expected health check response:

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00.000Z"
}
```

---

## Phase 9: Google OAuth Setup

OAuth redirect URIs must be updated after deployment to allow the production domain.

### Supabase Dashboard

1. Go to your Supabase project > **Authentication > Providers > Google**.
2. Enable the Google provider.
3. Enter your **Google Client ID** and **Google Client Secret**.
4. Under **Redirect URLs**, add the production callback URL. The Supabase callback URL is shown on the same page (format: `https://xxxxx.supabase.co/auth/v1/callback`).

### Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com) > **APIs & Services > Credentials**.
2. Select your OAuth 2.0 Client ID.
3. Under **Authorized redirect URIs**, add:
   - `https://insighta.one/oauth/callback`
   - The Supabase callback URL shown in your Supabase dashboard (e.g., `https://xxxxx.supabase.co/auth/v1/callback`)
4. Save.

---

## Troubleshooting

### SSH connection fails: UNPROTECTED PRIVATE KEY FILE

```
WARNING: UNPROTECTED PRIVATE KEY FILE!
Permissions 0644 for 'your-key.pem' are too open.
```

Fix the file permissions:

```bash
chmod 400 ~/Downloads/your-key.pem
```

### Docker image pull fails: repository name must be lowercase

```
invalid reference format: repository name must be lowercase
```

GHCR image tags must be fully lowercase. Check the image paths in `deploy.yml`:

```yaml
API_IMAGE: ghcr.io/jk42jj/insighta-api
FRONTEND_IMAGE: ghcr.io/jk42jj/insighta-frontend
```

Ensure the GitHub username and repository name in the image path are lowercase.

### Certbot automatic installation fails

```
Could not automatically find a matching server block for insighta.one
```

This occurs when the Nginx `server_name` directive does not match the domain requested by Certbot. Verify that `sites-enabled/insighta` is symlinked and `sites-enabled/default` is removed, then retry:

```bash
sudo certbot install --cert-name insighta.one
sudo systemctl restart nginx
```

### GitHub push blocked by Push Protection

GitHub Secret Scanning may block a push if secrets were previously committed to the repository history.

Options:
- Click the unblock URL included in the error message to bypass the specific secret.
- Or go to **Settings > Security > Secret scanning > Push protection** and temporarily disable it.

After unblocking, rotate any exposed secrets before re-enabling protection.

### Prisma migration fails

```
Error: PrismaClientInitializationError: Can't reach database server
```

Confirm `DIRECT_URL` is set to the **Session Pooler** URL (port 5432). The Transaction Pooler (port 6543) does not support the DDL statements required for migrations.

Also confirm the connection string ends without `?pgbouncer=true` for `DIRECT_URL`.

### Frontend container does not start

The `insighta-frontend` service depends on `insighta-api` with `condition: service_healthy`. If the API container fails its healthcheck, the frontend will not start. Investigate the API container logs first:

```bash
docker logs insighta-api --tail 50
```

Common causes: missing or incorrect environment variables in `/opt/insighta/.env`.

### Out of memory on t2.micro

The t2.micro instance has 1 GiB of RAM. The setup script allocates a 2 GiB swap file to compensate. If the system runs out of memory:

```bash
# Check current memory and swap usage
free -h

# Check which process is consuming most memory
docker stats --no-stream
```

If the API or frontend containers exceed their memory limits (512 MiB and 256 MiB respectively), reduce limits in `docker-compose.prod.yml` or investigate memory leaks.

---

## Manual Rollback

### Via GitHub Actions

Go to **Actions > Rollback** in your repository and click **Run workflow**.

- `version: previous` rolls back to the previously running containers.
- `version: <commit-sha>` rolls back to a specific image tag (the full or short commit SHA used during the build).

The rollback workflow SSH-es into EC2, pulls the specified image tag, and restarts the services. It then polls the health endpoint up to 6 times to confirm the rollback was successful.

### Directly on EC2

```bash
ssh -i ~/Downloads/your-key.pem ubuntu@<ELASTIC_IP>
cd /opt/insighta

# Stop and restart with the currently pulled images
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# To roll back to a specific version, update API_IMAGE and FRONTEND_IMAGE in .env
# then pull and restart:
# nano .env
# (set API_IMAGE=ghcr.io/jk42jj/insighta-api:<sha>)
# (set FRONTEND_IMAGE=ghcr.io/jk42jj/insighta-frontend:<sha>)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Cost Summary

All services below are free within their respective free tier or public tier limits. The only ongoing cost is the domain registration.

| Service | Cost | Notes |
|---|---|---|
| Supabase Cloud (Free) | $0/mo | 500 MB database, 50,000 MAU |
| AWS EC2 t2.micro | $0/mo | Free Tier: 12 months from account creation |
| AWS Elastic IP | $0/mo | Free when associated with a running instance |
| GHCR (Public) | $0/mo | Free for public repositories |
| GitHub Actions | $0/mo | Free for public repos; 2,000 min/mo for private repos |
| Domain registration | ~$10-15/yr | Varies by registrar and TLD |
| **Total** | **~$1/mo** | Within Free Tier period |

After the 12-month AWS Free Tier period ends, an EC2 t2.micro instance costs approximately $8.50/month on-demand in us-west-2.

---

## Related Files

| File | Description |
|---|---|
| `.github/workflows/ci.yml` | CI pipeline: lint, typecheck, test, build |
| `.github/workflows/deploy.yml` | CD pipeline: build images, migrate DB, deploy to EC2 |
| `.github/workflows/rollback.yml` | Manual rollback workflow |
| `docker-compose.prod.yml` | Production Docker Compose (API + Frontend) |
| `deploy/nginx/insighta.conf` | Nginx reverse proxy with SSL configuration |
| `scripts/ec2-setup.sh` | EC2 instance initialization script |
| `.env.production.example` | Environment variable template for production |
| `prisma/schema.prisma` | Database schema (includes `directUrl` for migrations) |
