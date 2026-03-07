# Insighta Operations Manual

**Project**: Insighta
**Domain**: https://insighta.one
**Last Updated**: 2026-03-07

---

## Table of Contents

1. [Infrastructure Strategy](#1-infrastructure-strategy)
2. [Branch and Release Strategy](#2-branch-and-release-strategy)
3. [Deployment Procedures](#3-deployment-procedures)
4. [Monitoring and Alerting](#4-monitoring-and-alerting)
5. [Security](#5-security)
6. [Backup and Recovery](#6-backup-and-recovery)
7. [Long-Term Roadmap](#7-long-term-roadmap)
8. [Agent Workflow & Quality Management](#8-agent-workflow--quality-management)

---

## 1. Infrastructure Strategy

### 1.1 AWS Architecture Overview

```
Internet
    |
    | HTTPS 443 / HTTP 80
    v
[insighta.one] --DNS A--> [44.231.152.49] (Elastic IP)
                                |
                    +-----------+----------+
                    |  EC2 t2.micro        |
                    |  Ubuntu 22.04 LTS    |
                    |  us-west-2           |
                    |                      |
                    |  Host Nginx          |
                    |  (SSL termination)   |
                    |    |                 |
                    |    +-> :3000  API    | <-- Docker: insighta-api
                    |    +-> :8081  UI     | <-- Docker: insighta-frontend
                    |                      |
                    |  Storage: 20 GiB gp2 |
                    |  Swap:    2 GiB      |
                    +----------+-----------+
                               |
              +----------------+------------------+
              |                                   |
    [Supabase Cloud]                      [GHCR]
    us-west-2 Oregon                ghcr.io/jk42jj/
    rckkhhjanqgaopynhfgd             insighta-api
    - PostgreSQL                     insighta-frontend
    - Auth (Google OAuth)
    - Edge Functions (4)
    - JWT issuance
```

**Key design decisions:**

- Host Nginx performs SSL termination. Docker containers bind to `127.0.0.1` only and are never directly reachable from the internet.
- The API container (Fastify) runs on port 3000. The frontend container (Nginx serving the React SPA) runs on port 8081.
- Supabase Cloud manages the database and authentication. No database container runs on EC2.
- Docker images are built by GitHub Actions and pushed to GHCR. EC2 only pulls and runs pre-built images.
- Database schema changes are applied by GitHub Actions via `prisma db push` using the Supabase Session Pooler (`DIRECT_URL`, port 5432).

### 1.2 Terraform Module Structure

All infrastructure is defined as code in the `terraform/` directory. Modules are reusable across projects.

```
terraform/
  modules/
    networking/       # VPC and subnet selection (currently uses default VPC)
    security/         # Security groups with variable ingress rules
    compute/          # EC2 instance, Elastic IP, cloud-init template
    iam/              # IAM roles and instance profiles (SSM, CloudWatch)
    state-backend/    # S3 bucket + DynamoDB table for remote state
  projects/
    insighta/
      environments/
        prod/         # Insighta production (main.tf, variables.tf, backend.tf)
    _template/
      environments/
        prod/         # Copy this to create a new project
  global/
    state-backend/    # Bootstrap: run once to create S3 and DynamoDB
    iam-ci/           # GitHub Actions IAM user with least-privilege policy
```

**Module responsibilities:**

| Module | Manages | Key variables |
|--------|---------|---------------|
| `networking` | VPC and subnet lookup | `use_default_vpc` |
| `security` | Security group and inbound rules | `ingress_rules`, `vpc_id` |
| `compute` | EC2 instance, EIP, user-data | `instance_type`, `ami_id`, `root_volume_size` |
| `iam` | Instance profile, SSM policy, CloudWatch policy | `enable_ssm`, `enable_cloudwatch` |
| `state-backend` | S3 bucket, DynamoDB lock table | `project_name`, `environment` |

### 1.3 Bootstrap: Remote State (One-Time)

Remote state must exist before any project environment can be managed. Run this once per AWS account:

```bash
cd terraform/global/state-backend
terraform init
terraform apply
```

This creates:
- S3 bucket `insighta-terraform-state` for state storage
- DynamoDB table `insighta-terraform-locks` for state locking

### 1.4 Bootstrap: CI IAM User (One-Time)

The Terraform workflow authenticates as a dedicated IAM user with least-privilege permissions:

```bash
cd terraform/global/iam-ci
terraform init
terraform apply
```

After apply, copy the output access key and secret into GitHub Secrets as `TF_AWS_ACCESS_KEY_ID` and `TF_AWS_SECRET_ACCESS_KEY`.

### 1.5 Managing Insighta Production

**Initial import** (existing infrastructure was created manually and must be imported once):

```bash
cd terraform/projects/insighta/environments/prod
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: set ami_id, key_name, instance_type, etc.

terraform init
terraform import module.compute.aws_instance.this i-XXXXXXXXXXXX
terraform import module.compute.aws_eip.this eipalloc-XXXXXXXXXXXX
terraform import module.security.aws_security_group.this sg-XXXXXXXXXXXX
terraform plan
# Output should show "No changes" once import is complete
```

**Making infrastructure changes:**

1. Edit `.tf` files in `terraform/projects/insighta/environments/prod/`
2. Open a pull request targeting `main`
3. GitHub Actions runs `terraform plan` and posts the output as a PR comment
4. Review the plan, then merge to `main`
5. GitHub Actions runs `terraform apply` with the `production` environment approval gate

**Required GitHub Secrets for Terraform:**

| Secret | Description |
|--------|-------------|
| `TF_AWS_ACCESS_KEY_ID` | CI IAM user access key |
| `TF_AWS_SECRET_ACCESS_KEY` | CI IAM user secret key |

### 1.6 Creating a New Project

```bash
cp -r terraform/projects/_template terraform/projects/my-new-project
cd terraform/projects/my-new-project/environments/prod

# Edit backend.tf: change the state key to avoid collision
#   key = "my-new-project/prod/terraform.tfstate"

# Edit terraform.tfvars with project-specific values
cp terraform.tfvars.example terraform.tfvars

terraform init
terraform apply
```

### 1.7 Cost Structure

Current infrastructure runs at minimal cost within the AWS Free Tier period. Costs increase as monitoring features are added.

| Item | Current | Phase 1 (Terraform IaC) | Phase 2 (Monitoring) |
|------|---------|-------------------------|----------------------|
| EC2 t2.micro (on-demand, post-free-tier) | ~$8.50/mo | $0 added | $0 added |
| S3 remote state | $0 | +$0.05/mo | $0 added |
| DynamoDB state locking | $0 | +$0.25/mo | $0 added |
| CloudWatch metrics/alarms | $0 | $0 | +$3-5/mo |
| **Total** | **~$8.50/mo** | **~$8.80/mo** | **~$12-14/mo** |

Notes:
- EC2 t2.micro is free for 12 months from account creation. After that, the on-demand price in us-west-2 is approximately $8.50/month.
- Elastic IP is free while associated with a running instance.
- GHCR and GitHub Actions are free for public repositories.
- Supabase Cloud Free tier: 500 MB database, 50,000 MAU. No cost at current scale.

---

## 2. Branch and Release Strategy

### 2.1 Branch Flow

```
story/xx-name  ─┐
fix/xx-name    ─┼──>  main (production)
feature/xx     ─┘
                      master (legacy dev, kept as GitHub default)
```

- **`main`** is the production branch. All story/feature/fix branches target `main` via PR. A merged PR to `main` triggers the deploy pipeline automatically.
- **`master`** is the legacy development branch, retained as GitHub default. Historically used as dev target, now superseded by direct-to-main workflow.
- **Story branches** follow the naming convention `story/<issue-number>-<short-name>` (e.g., `story/65-design-system`).
- **Fix branches** use `fix/<issue-number>-<short-name>`.
- Branches are deleted after PR merge (squash merge preferred).
- Direct commits to `main` are not permitted.

### 2.2 Pull Request Rules

| Rule | Applies to |
|------|-----------|
| CI must pass before merge | All PRs to `master` and `master` -> `main` |
| At least one reviewer approval | `master` -> `main` PRs |
| Branch must be up to date | Recommended |
| Linear history preferred | Squash or rebase merge |

CI jobs that must pass: `typecheck`, `build-api`, `build-frontend`. The `lint` and `test` jobs run with `continue-on-error: true` and do not block merges.

### 2.3 Merging to Production

```bash
# Create a PR from story branch to main:
gh pr create --base main --head story/65-design-system --title "feat: design system (#65)"

# After CI passes, squash merge and delete branch:
gh pr merge <number> --squash --delete-branch

# The deploy.yml pipeline triggers automatically on push to main
```

Deployment is also manually triggerable from the GitHub Actions UI without a new push:

```bash
gh workflow run deploy.yml
```

### 2.4 Rollback

**Via GitHub Actions (preferred):**

```bash
gh workflow run rollback.yml -f version=previous
# or roll back to a specific commit SHA:
gh workflow run rollback.yml -f version=abc1234
```

The rollback workflow SSH-es into EC2, pulls the specified image tag from GHCR, restarts the containers, and polls the health endpoint to confirm success.

**Directly on EC2 (emergency):**

```bash
ssh -i ~/Downloads/prx01-tubearchive.pem ubuntu@44.231.152.49
cd /opt/tubearchive

# Roll back to a specific image version
export API_IMAGE=ghcr.io/jk42jj/insighta-api:<sha>
export FRONTEND_IMAGE=ghcr.io/jk42jj/insighta-frontend:<sha>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans

# Verify
curl -s http://localhost:3000/health
```

To find available image tags:

```bash
gh api /user/packages/container/insighta-api/versions \
  --jq '.[].metadata.container.tags'
```

### 2.5 Terraform Change Workflow

| Event | Action |
|-------|--------|
| PR opened with `terraform/**` changes | `terraform validate` + `terraform plan` runs; plan posted as PR comment |
| PR merged to `main` with `terraform/**` changes | `terraform apply` runs with `production` environment approval gate |
| No `terraform/**` changes in PR | Terraform workflow does not trigger |

The `production` environment in GitHub requires manual approval before `terraform apply` executes. This prevents unreviewed infrastructure changes from being applied automatically.

---

## 3. Deployment Procedures

### 3.1 Standard Code Deployment

The complete sequence from code change to live production:

```
1. Developer pushes to master
        |
2. CI (ci.yml) - runs in parallel:
   - lint        (continue-on-error: true)
   - typecheck   (must pass)
   - test        (continue-on-error: true)
   - build-api   (must pass, depends on typecheck)
   - build-frontend (must pass)
        |
3. build-and-push: Docker images built and pushed to GHCR
   - ghcr.io/jk42jj/insighta-api:latest
   - ghcr.io/jk42jj/insighta-api:<git-sha>
   - ghcr.io/jk42jj/insighta-frontend:latest
   - ghcr.io/jk42jj/insighta-frontend:<git-sha>
        |
4. migrate: prisma db push (via DIRECT_URL, port 5432)
        |
5. deploy-edge-functions: supabase functions deploy (4 functions)
        |
6. deploy: SSH to EC2
   - docker compose pull
   - docker compose up -d --remove-orphans
   - Health check: curl http://localhost:3000/health (6 retries, 10s each)
   - If health check fails: automatic rollback + exit 1
   - If success: docker image prune -f
        |
7. Verify: curl https://insighta.one/health
```

Monitor the pipeline at: https://github.com/JK42JJ/insighta/actions

### 3.2 Infrastructure Deployment

For changes to EC2, security groups, IAM, or networking:

1. Edit files in `terraform/projects/insighta/environments/prod/`
2. Open a PR to `main`
3. Inspect the `terraform plan` output posted as a PR comment
4. Approve and merge the PR
5. Approve the `production` environment gate in GitHub Actions
6. Confirm `terraform apply` completes without error
7. Verify the running infrastructure matches expectations

```bash
# After apply, verify EC2 instance state:
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=insighta" \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,PublicIpAddress]' \
  --output table
```

### 3.3 Edge Function Deployment

Edge functions are deployed automatically by `deploy.yml` on every push to `main`. They are deployed before the Docker containers start.

The four deployed functions are:

| Function | Description |
|----------|-------------|
| `local-cards` | User card state management |
| `youtube-sync` | YouTube playlist synchronization trigger |
| `youtube-auth` | YouTube OAuth token exchange |
| `fetch-url-metadata` | URL metadata fetching |

All functions are deployed with `--no-verify-jwt` and handle their own authorization internally.

**Canonical source**: `supabase/functions/` in the main repository. Changes here are deployed automatically.

To deploy manually:

```bash
supabase functions deploy local-cards \
  --project-ref rckkhhjanqgaopynhfgd \
  --no-verify-jwt
```

### 3.4 Database Schema Changes

The current migration strategy uses `prisma db push` rather than `prisma migrate deploy`. This is due to a conflict between Prisma's migration history and the pre-existing Supabase `auth` schema (error P3005).

**Procedure for schema changes:**

1. Edit `prisma/schema.prisma` locally
2. Run `npx prisma generate` to update the Prisma Client
3. Test locally with `npx prisma db push` against a development database
4. Commit and open a PR to `master`
5. On merge to `main`, the deploy pipeline runs `prisma db push --skip-generate` via the `DIRECT_URL` (Session Pooler, port 5432)

> The Transaction Pooler (port 6543, `DATABASE_URL`) does not support DDL statements. Always use `DIRECT_URL` for schema operations.

**RLS policies** are defined in `prisma/migrations/rls_policies.sql`. Apply manually via the Supabase Dashboard SQL Editor after schema changes that add new tables.

### 3.5 SSH Access to EC2

```bash
ssh -i ~/Downloads/prx01-tubearchive.pem ubuntu@44.231.152.49
```

The SSH key must have permissions `400`:

```bash
chmod 400 ~/Downloads/prx01-tubearchive.pem
```

The EC2 Security Group currently restricts SSH (port 22) to a single administrator IP. If your IP has changed, update the Security Group before connecting:

1. AWS Console > EC2 > Security Groups
2. Select the Insighta security group > Inbound rules > Edit inbound rules
3. SSH rule > Source > My IP
4. Save rules

**Important**: GitHub Actions runners do not have a fixed IP. If the SSH rule is restricted to a single IP, the `deploy.yml` workflow's SSH step will fail. Options to resolve this:

| Option | Effort | Notes |
|--------|--------|-------|
| Temporarily open SSH to `0.0.0.0/0` during deploy, then restore | Manual | Acceptable for infrequent deploys |
| Add GitHub Actions IP ranges to Security Group | Manual | GitHub IP ranges change frequently |
| Use AWS SSM Session Manager instead of SSH | Medium | Eliminates open SSH port entirely |
| Manage Security Group via Terraform, automate updates | Medium | Best long-term solution |

### 3.6 Common Operational Commands on EC2

```bash
cd /opt/tubearchive

# Container status
docker ps
docker compose -f docker-compose.prod.yml ps

# Real-time logs
docker logs insighta-api --tail 100 -f
docker logs insighta-frontend --tail 50 -f

# Restart a single service
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml restart frontend

# Full restart
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Pull and redeploy latest images manually
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
docker image prune -f

# System resources
free -h
df -h
docker system df
docker stats --no-stream

# Nginx
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx
```

---

## 4. Monitoring and Alerting

### 4.1 Current State (Phase 1)

Monitoring is currently manual. The following checks confirm system health:

**Health endpoints:**

```bash
# External HTTPS check (through Nginx + SSL)
curl -s https://insighta.one/health

# Direct API check (from EC2)
curl -s http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"...","uptime":...,"version":"1.0.0"}
```

**Docker container health:**

```bash
docker inspect --format='{{.State.Health.Status}}' insighta-api
docker inspect --format='{{.State.Health.Status}}' insighta-frontend
# Both should return: healthy
```

The Docker Compose file configures healthchecks for both containers:

| Container | Command | Interval |
|-----------|---------|----------|
| `insighta-api` | `curl http://localhost:3000/health` | 30s |
| `insighta-frontend` | `wget http://localhost:8081/` | 30s |

**Automated daily check script:**

```bash
# Full check (requires SSH access)
./scripts/daily-healthcheck.sh

# External checks only (no SSH required)
./scripts/daily-healthcheck.sh --local-only

# JSON output for programmatic parsing
./scripts/daily-healthcheck.sh --json
```

Exit codes: `0` = all pass, `1` = warnings present, `2` = critical failures.

The script covers 8 checks:

| Check | Criterion |
|-------|-----------|
| Site HTTPS reachable | HTTP 200 |
| `/health` responds with valid JSON | 200 + JSON body |
| Auth endpoint returns 401 (not 500) | 401 is correct |
| SSL certificate not expiring within 30 days | Days remaining > 30 |
| Docker containers healthy (SSH) | `healthy` status |
| Disk usage below 80% (SSH) | `df` output |
| Memory usage below 90% (SSH) | `free` output |
| Most recent GitHub Actions deploy succeeded | API query |

**Periodic checks:**

| Frequency | Task | Command |
|-----------|------|---------|
| Weekly | Docker resource cleanup | `docker system prune -f` on EC2 |
| Weekly | SSL renewal dry run | `sudo certbot renew --dry-run` on EC2 |
| Weekly | Log size review | `docker system df` on EC2 |
| Monthly | Manual database backup | See Section 6.2 |
| Monthly | Security Group review | Confirm SSH source IP is current |
| Monthly | GitHub Secrets review | Confirm no expired tokens or keys |

### 4.2 Incident Response

When the site is inaccessible, work through this diagnostic flow:

```
Site unreachable
    |
    +-- DNS: dig insighta.one +short
    |       Returns 44.231.152.49? If not, check GoDaddy DNS.
    |
    +-- SSL: curl -vI https://insighta.one 2>&1 | grep -E "TLS|SSL|expire"
    |       Certificate expired? Run: sudo certbot renew
    |
    +-- Nginx: sudo systemctl status nginx
    |       Stopped? Run: sudo systemctl start nginx
    |       Config error? Run: sudo nginx -t
    |
    +-- Docker: docker ps
    |       Containers absent? Run: docker compose -f docker-compose.prod.yml up -d
    |       Container unhealthy? Run: docker logs <container> --tail 100
    |       Container restarting? Check memory: htop, free -h
    |
    +-- EC2: Check AWS Console > EC2 > Instances
            Instance stopped? Start it.
```

**API 500 errors:**

```bash
docker logs insighta-api --tail 100

# Test database connectivity from within the container
docker exec insighta-api node -e "
  const { PrismaClient } = require('@prisma/client');
  new PrismaClient().\$connect()
    .then(() => console.log('DB: OK'))
    .catch(e => console.error('DB: FAIL', e.message))
"
```

**Out of memory:**

```bash
free -h
docker stats --no-stream
swapon --show

# Restart services to recover memory
docker compose -f docker-compose.prod.yml restart
```

**Disk full:**

```bash
df -h
docker system prune -f
docker image prune -a -f
sudo journalctl --vacuum-time=3d
```

### 4.3 Phase 2 Monitoring Plan

When the application grows beyond a single administrator's manual oversight capacity, add structured monitoring.

**Option A: AWS CloudWatch** (lower operational cost)

- EC2 agent: CPU, memory, disk metrics
- Alarms: CPU > 80%, memory > 85%, disk > 80%
- Estimated cost: $3-5/month (see Section 1.7)
- Enable via Terraform: set `enable_cloudwatch = true` in `terraform.tfvars`

**Option B: Prometheus + Grafana** (richer visualization, self-hosted)

- Run as Docker containers on EC2 alongside the application
- Fastify exposes a `/metrics` endpoint (requires `fastify-metrics` plugin)
- Grafana dashboards for request rate, error rate, response time, resource usage
- Suitable when t2.micro is replaced with a larger instance type

**Alerting channels to configure:**

- Email via AWS SNS or Grafana alert rules
- Slack webhook for critical incidents
- PagerDuty or equivalent for on-call rotation (when team grows)

---

## 5. Security

### 5.1 Secret Management

Secrets never appear in the repository. They are stored in two locations:

| Location | Contains | Access |
|----------|---------|--------|
| `/opt/tubearchive/.env` on EC2 | Runtime environment variables | SSH only |
| GitHub Actions Secrets (14 secrets) | CI/CD pipeline values | GitHub Settings |

The `.env` file on EC2 is the authoritative runtime source. GitHub Secrets are used only during the deploy pipeline to build Docker images and run migrations. After deployment, the containers read from the `.env` file on disk.

**To update a secret:**

1. SSH into EC2 and edit `/opt/tubearchive/.env`
2. Restart the affected container: `docker compose -f docker-compose.prod.yml restart api`
3. If the secret is also used in CI/CD, update the corresponding GitHub Secret at https://github.com/JK42JJ/insighta/settings/secrets/actions

**The 14 required GitHub Secrets:**

| Secret | Used by |
|--------|---------|
| `EC2_HOST` | deploy.yml SSH step |
| `EC2_USER` | deploy.yml SSH step |
| `EC2_SSH_KEY` | deploy.yml SSH step |
| `DATABASE_URL` | migrate job (not currently used; see Section 3.4) |
| `DIRECT_URL` | migrate job (`prisma db push`) |
| `SUPABASE_URL` | Frontend Docker build args |
| `SUPABASE_ANON_KEY` | Frontend Docker build args |
| `SUPABASE_SERVICE_ROLE_KEY` | API runtime via .env |
| `SUPABASE_JWT_SECRET` | API runtime via .env |
| `SUPABASE_ACCESS_TOKEN` | deploy-edge-functions job |
| `YOUTUBE_API_KEY` | API runtime via .env |
| `YOUTUBE_CLIENT_ID` | API runtime via .env |
| `YOUTUBE_CLIENT_SECRET` | API runtime via .env |
| `ENCRYPTION_SECRET` | API runtime via .env |
| `DOMAIN` | deploy.yml verification step |

### 5.2 SSH Key Management

- The EC2 SSH key (`prx01-tubearchive.pem`) is stored locally at `~/Downloads/prx01-tubearchive.pem`
- File permissions must be `400`: `chmod 400 ~/Downloads/prx01-tubearchive.pem`
- The full key contents (including header and footer lines) are stored in the `EC2_SSH_KEY` GitHub Secret
- If the key is compromised: generate a new key pair in EC2, replace the authorized key on the instance, and update the GitHub Secret immediately

### 5.3 AWS IAM Policies

**Terraform CI user** (`terraform/global/iam-ci/`): Has the minimum permissions required to manage EC2 instances, security groups, IAM roles, S3 state, and DynamoDB locks. Has no access to other AWS services.

**EC2 instance profile** (`terraform/modules/iam/`): Grants the EC2 instance access to SSM (optional, for SSH replacement) and CloudWatch (optional, for metrics). No S3 or other data service access.

**Principle**: no AWS credential is granted more access than what its specific function requires. Expand permissions only when a new operational need arises and document the reason.

### 5.4 Network Security

| Control | Configuration |
|---------|--------------|
| Inbound SSH | Port 22, restricted to administrator IP (or 0.0.0.0/0 when GitHub Actions deploy is active) |
| Inbound HTTP | Port 80, open; Nginx immediately redirects to HTTPS |
| Inbound HTTPS | Port 443, open |
| Docker ports | `127.0.0.1:3000` and `127.0.0.1:8081`; not reachable from outside the host |
| UFW firewall | Active on EC2; allows SSH, HTTP, HTTPS only |
| Nginx rate limiting | 30 requests/second per IP on `/api/`, burst 50 |
| HSTS | `max-age=63072000; includeSubDomains; preload` |
| Security headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin` |

### 5.5 SSL Certificate Management

Certificates are issued and renewed by Let's Encrypt via Certbot.

| Detail | Value |
|--------|-------|
| Issuer | Let's Encrypt |
| Domains | `insighta.one`, `www.insighta.one` |
| Expiry | 2026-06-02 (auto-renewed) |
| Certificate path | `/etc/letsencrypt/live/insighta.one/` |
| Renewal | Certbot systemd timer (automatic, ~60 days before expiry) |

```bash
# Check certificate status
sudo certbot certificates

# Test renewal process without making changes
sudo certbot renew --dry-run

# Force renewal if needed
sudo certbot renew
sudo systemctl reload nginx
```

### 5.6 Supabase Row-Level Security

RLS policies are applied to all 16 tables in the `public` schema. They enforce that users can only read and write rows that belong to their own `user_id`.

- Policies are defined in `prisma/migrations/rls_policies.sql`
- The API server connects as the Postgres superuser via Prisma and bypasses RLS by design. Authorization in the API layer is enforced by JWT verification in `src/api/plugins/auth.ts`.
- Direct access through the Supabase Dashboard or client SDK is subject to RLS.

Tables that are fully locked (no user access, server-only):

- `credentials`
- `quota_usage`
- `quota_operations`

### 5.7 Google OAuth

- **Current state**: Testing mode. The OAuth consent screen displays a "Google hasn't verified this app" warning. Users must click "Continue" to proceed. Limited to 100 test users.
- **Production transition**: Go to Google Cloud Console > APIs and Services > OAuth consent screen > Publish App. Google reviews the application before approval. Requires a live privacy policy URL and terms of service URL.
- **Redirect URIs** registered in Google Cloud Console:
  - `https://insighta.one/oauth/callback`
  - `https://rckkhhjanqgaopynhfgd.supabase.co/auth/v1/callback`

---

## 6. Backup and Recovery

### 6.1 Automated Database Backup

**Schedule**: Daily at 03:00 UTC via GitHub Actions (`.github/workflows/backup.yml`)

**Pipeline**:
1. `pg_dump` public schema → gzip compress
2. Validate: file size ≥1KB, ≥5 CREATE TABLE statements
3. Upload to `s3://insighta-backups/db/YYYY/MM/backup_YYYYMMDD.sql.gz`
4. Cleanup backups older than 30 days
5. On failure: auto-creates GitHub Issue with `backup-failure` label

**Infrastructure** (Terraform `modules/backup`):
- S3 bucket: `insighta-backups` (versioned, encrypted AES256, no public access)
- Lifecycle: Standard → Standard-IA after 7 days, expire after 30 days
- IAM: CI user has S3 read/write/delete on the backup bucket

**Required GitHub Secrets**: `DIRECT_URL`, `TF_AWS_ACCESS_KEY_ID`, `TF_AWS_SECRET_ACCESS_KEY`

**Manual trigger**: `gh workflow run backup.yml`

### 6.2 Manual Database Backup

Run from any machine that has the `DIRECT_URL` available:

```bash
# Compressed dump (recommended)
pg_dump "$DIRECT_URL" \
  --schema=public \
  --no-owner \
  --no-acl \
  | gzip > backup_$(date +%Y%m%d).sql.gz
```

### 6.3 Database Recovery

```bash
# Restore from a SQL dump
psql "$DIRECT_URL" < backup_20260306.sql

# If the target database has data that must be cleared first:
psql "$DIRECT_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DIRECT_URL" < backup_20260306.sql
```

After restoring, re-apply RLS policies:

```bash
psql "$DIRECT_URL" < prisma/migrations/rls_policies.sql
```

### 6.4 Docker Volume Backup

The API container uses two named volumes:

| Volume | Mount path | Contents |
|--------|-----------|----------|
| `insighta_cache_data` | `/app/cache` (API container) | API response cache |
| `insighta_logs_data` | `/app/logs` (API container) | Application log files |

These volumes are ephemeral aids (cache and logs) and are not critical for recovery. The database is the only stateful data store that requires backup.

To back up volumes if needed:

```bash
# On EC2
docker run --rm \
  -v insighta_cache_data:/data \
  -v /tmp:/backup \
  alpine tar czf /backup/cache_backup_$(date +%Y%m%d).tar.gz /data
```

### 6.5 Full Server Recovery

If the EC2 instance is lost and must be recreated:

1. Run `terraform apply` to provision a new instance with the same configuration
2. SSH into the new instance
3. Transfer `docker-compose.prod.yml` and `.env` to `/opt/tubearchive/`
4. Log in to GHCR: `echo "<PAT>" | docker login ghcr.io -u <username> --password-stdin`
5. Run `docker compose -f docker-compose.prod.yml up -d`
6. Reassociate the Elastic IP with the new instance in the AWS Console (or let Terraform handle it)
7. Verify the health endpoint: `curl https://insighta.one/health`

The database is hosted on Supabase Cloud and is unaffected by EC2 loss. DNS and SSL require no changes because the Elastic IP is reassociated, not reallocated.

---

## 7. Long-Term Roadmap

### Phase 1: Terraform IaC (Current)

**Goal**: All infrastructure reproducible from code. No manual resource creation.

- [x] Reusable Terraform module library (networking, security, compute, IAM, state-backend)
- [x] Remote state: S3 + DynamoDB locking
- [x] Least-privilege CI IAM user
- [x] `terraform.yml` workflow: plan on PR, apply on main with approval gate
- [x] Insighta production environment imported and managed

**Remaining:**
- [ ] Resolve the SSH access issue for GitHub Actions deploys (SSM or IP automation)
- [ ] Automate Security Group IP updates as part of the deploy workflow

### Phase 2: Monitoring Stack

**Goal**: Proactive alerting. Know about problems before users report them.

**Trigger**: When manual daily checks become unsustainable or when the application reaches more than a few hundred active users.

**Implementation options:**

Option A (AWS CloudWatch, lower cost):
- Enable the CloudWatch agent on EC2 via the existing IAM module (`enable_cloudwatch = true`)
- Create alarms for: CPU > 80%, memory > 85%, disk > 80%, health check failures
- Route alerts to SNS > email
- Additional cost: $3-5/month (see Section 1.7)

Option B (Prometheus + Grafana, self-hosted):
- Add a `monitoring` service to `docker-compose.prod.yml`
- Expose a `/metrics` endpoint from the Fastify API
- Grafana dashboards for request rate, P95 latency, error rate, container resource usage
- Prerequisite: upgrade EC2 from t2.micro to t3.small or larger to accommodate additional memory use

**Minimum alerting targets regardless of option:**
- HTTP 5xx error rate > 1% over 5 minutes
- Health endpoint non-200 for > 2 minutes
- Disk usage > 80%
- Memory usage > 85%
- SSL certificate expiry < 14 days

### Phase 3: Kubernetes Migration (EKS + ArgoCD)

**Goal**: Horizontal scalability, zero-downtime deploys, multi-service isolation.

**Trigger**: Only when the number of backend services exceeds 10, or when a single EC2 instance can no longer handle peak load, or when team size exceeds 5 engineers.

**Architecture:**

```
GitHub (main) --> ArgoCD (GitOps) --> EKS Cluster
                                        |
                              +----+----+----+
                              |    |    |    |
                             svc  svc  svc  svc
                            (API)(UI)(worker)(...)
```

**Estimated cost at migration point:**

| Item | Monthly cost |
|------|-------------|
| EKS control plane | $72 |
| 2x t3.medium worker nodes | ~$60 |
| Load balancer (ALB) | ~$20 |
| ECR or GHCR (images) | $0-5 |
| CloudWatch or Datadog | $15-30 |
| **Total** | **~$167-187/mo** |

This cost is only justified when the application generates revenue or serves a user base that requires this level of reliability and scalability. Do not migrate prematurely.

**Prerequisites before migration:**
- All services have health endpoints and graceful shutdown handling
- Helm charts or Kustomize manifests prepared for each service
- ArgoCD installed and connected to the repository
- Secrets managed via AWS Secrets Manager or External Secrets Operator
- Existing CI/CD pipelines produce OCI-compliant images (already true)

---

## 8. Agent Workflow & Quality Management

### 8.1 Role Separation

| Role | Responsibility | Actions |
|------|---------------|---------|
| **Main (Orchestrator)** | "What & Why" — task analysis, agent selection, user communication | Issue analysis, agent dispatch, final reporting |
| **PM (Quality Gate)** | "How Well" — quality judgment (read-only) | tsc/lint/regression check, APPROVED/REJECTED/CONDITIONS verdict |
| **QA (test-runner)** | "Does it work" — functional verification | Test planning, execution, coverage reporting |

**Workflow**:
```
User -> Main (analyze/dispatch) -> Agent(s) (implement) -> QA (test) -> PM (judge) -> Main (report) -> User
```

### 8.2 Token-Aware Delegation Policy (Tier System)

| Tier | Criteria | Token Cost | QA | PM | Example |
|------|----------|-----------|-----|-----|---------|
| **1 Inline** | 1 file, <=10 lines | 0 extra | No | No | Typo fix, config change, i18n key |
| **2 Single** | 1-3 files, single domain | ~30-50K | Optional | Optional | Component fix, hook addition |
| **3 Multi** | 4+ files OR 2+ domains | ~100-200K | Required | Required | Story-level feature, architecture change |

**Decision logic**:
```
1 file, <=10 lines        -> Tier 1 (Main handles directly)
1-3 files, single domain  -> Tier 2 (single agent + memory preload)
4+ files OR 2+ domains    -> Tier 3 (multi-agent pipeline)
```

**Token saving rules**:
- Provide agents only necessary files, not full context
- Include key information in issue body to reduce agent exploration
- Reuse patterns from agent memory files

### 8.3 Agent Memory System

Persistent knowledge accumulation per agent, stored in `.claude/agents/memory/`:

| File | Purpose |
|------|---------|
| `frontend-dev.md` | FSD structure, component patterns, motion tokens, view system |
| `test-runner.md` | Test strategy, Vitest/Playwright config, MSW patterns |
| `ux-designer.md` | A11y standards, responsive patterns, UX issue history |
| `cross-agent.md` | Project-wide conventions (all agents must read) |
| `delegation-metrics.md` | Daily token efficiency tracking |

**Memory preload pattern** (every agent spawn):
```
Agent(subagent_type="frontend-dev", prompt="
[PRE-LOAD] Read: .claude/agents/memory/frontend-dev.md, .claude/agents/memory/cross-agent.md
[ISSUE] #71: dnd-kit migration
[CONTEXT] {issue body or key summary}
[TASK] {specific work instructions}
")
```

**Update policy**:
- **Who**: Main updates after agent work completes
- **When**: Tier 2+ completion, new pattern discovery, mistake occurrence
- **What**: New patterns, mistake/resolution, convention changes

### 8.4 Rich Issue Template

All issues should be self-contained so agents can work from the issue alone:

```markdown
## Context
{Why this work is needed, which higher goal it serves}

## Related Context Files
- `memory/architecture.md` — architecture reference
- `.claude/agents/memory/frontend-dev.md` — frontend patterns

## Scope
### Files to Modify
- `frontend/src/widgets/xxx/ui/Component.tsx` — {change description}

### Files to Reference (Read-only)
- `frontend/src/types/mandala.ts` — InsightCard type reference

## Requirements
1. {Specific requirement}

## Acceptance Criteria
- [ ] `npx tsc --noEmit` passes
- [ ] {Functional verification}
- [ ] No regression in existing features

## Agent Assignment
- **Primary**: `agent:frontend-dev`
- **Review**: `agent:ux-designer`
- **QA**: `agent:test-runner`
- **Tier**: 2 or 3
```

### 8.5 Continuous Improvement: Retrospective System

**Daily (17:00)** — Record in `memory/retrospective.md`:
- Work summary table (task, tier, agents, tokens, duration, result)
- Quantified metrics: agent spawns, wasteful spawns, tier mismatches, PM rejections
- Quality score (0-10): code quality, token efficiency, delegation accuracy, prompt clarity
- Action items for next session
- Prompt engineering notes (effective/ineffective patterns)

**Weekly (every 7 days)** — Aggregate and compare:
- Metrics delta table (this week vs last week)
- Agent efficiency analysis (spawns, useful rate, token per spawn)
- Policy adjustments with numerical justification
- Update DELEGATION.md and agent memory files accordingly

**Measurement targets (progressive improvement)**:

| Metric | Month 1 | Month 2 | Month 3 |
|--------|---------|---------|---------|
| Wasteful spawn rate | <20% | <10% | <5% |
| Token per task (avg) | baseline | -15% | -30% |
| PM rejection rate | <20% | <10% | <5% |
| Tier mismatch rate | <15% | <8% | <3% |
| Avg quality score | 7/10 | 8/10 | 9/10 |

### 8.7 North Star: Multi-Project GraphRAG

현재 .md flat file 기반 시스템은 **GraphRAG의 Phase 0 (seed data)**에 해당한다.
궁극 목표는 **프로젝트를 수행할수록 복리로 빨라지는 시스템**.

**3-Layer Graph Architecture**:
```
Layer 3: Meta Graph      — cross-project 보편 지식 (무한 확장)
Layer 2: Project Graph   — per-project 구체 지식
Layer 1: Raw Data        — .md, source code, git history
```

**Evolution path**:
```
Phase 0: .md flat files (현재) ← Single Project
Phase 1-5: Knowledge Graph → MCP Server ← Single Project, 자동화
Phase 6: Multi-Project Meta Graph ← 프로젝트 간 지식 전이
Phase 7: Self-Evolving System ← 자율 정책 최적화 + 인간 승인
```

**핵심 KPI**:
- Project N의 소요 시간이 Project 1 대비 시간에 비례하여 감소
- 목표: Project 5에서 50% 감소, Project 10에서 80% 감소
- 신규 프로젝트 부트스트랩: 2-3일 → 30분

**상세 로드맵**: [`docs/graph-rag-roadmap.md`](graph-rag-roadmap.md)

### 8.6 Agent Roster (13 Agents)

| Agent | Badge | Role | Trigger | Tools |
|-------|-------|------|---------|-------|
| `pm` | PM | Final quality judgment | Tier 3 completion | Read/Grep/Glob/Bash (read-only) |
| `frontend-dev` | UI | React, hooks, components | `frontend/src/` changes | R/W/E/Bash |
| `backend-dev` | API | API, Prisma, services | `src/api/`, `prisma/` changes | R/W/E/Bash |
| `test-runner` | TST | Test + QA | Code changes (Tier 2+) | R/W/E/Bash |
| `ux-designer` | UXD | UX/a11y audit (read-only) | UI work (with frontend trio) | Read/Grep/Glob |
| `supabase-dev` | SB | Edge Functions, Docker | Supabase work | R/W/E/Bash |
| `infra-dev` | INFRA | AWS, Terraform, CI/CD | `terraform/`, `.github/` | R/W/E/Bash |
| `architect` | ARC | System design | Architecture changes | Read/Grep/Glob/Bash |
| `security-auditor` | SEC | Security audit | Auth/security code | Read/Grep/Glob/Bash |
| `docs-writer` | DOC | Technical docs | `docs/`, bulk `.md` | R/W/E |
| `adapter-dev` | ADP | OAuth/Feed/File adapters | `src/adapters/` | R/W/E/Bash |
| `sync-dev` | SYN | Sync logic, scheduling | `src/sync/` | R/W/E/Bash |
| `ai-integration-dev` | AI | AI integration | AI/LLM work | R/W/E/Bash |

**Required co-delegation (regression prevention)**:
- **UI work trio**: `frontend-dev` + `ux-designer` + `test-runner` — always spawn together for `frontend/src/` changes (Tier 3)

---

## Reference: Key File Locations

| File | Description |
|------|-------------|
| `docs/DEPLOYMENT.md` | Step-by-step initial deployment guide (9 phases) |
| `docs/OPERATIONS.md` | Korean-language operational runbook (daily operations detail) |
| `docs/operations-manual.md` | This document |
| `.github/workflows/ci.yml` | CI: lint, typecheck, test, build |
| `.github/workflows/deploy.yml` | CD: Docker build, Edge Functions, DB schema, EC2 deploy |
| `.github/workflows/rollback.yml` | Manual rollback to previous or specific image version |
| `.github/workflows/terraform.yml` | Infrastructure: plan on PR, apply on merge |
| `docker-compose.prod.yml` | Production container definitions (API + Frontend) |
| `deploy/nginx/insighta.conf` | Nginx reverse proxy and SSL configuration |
| `scripts/ec2-setup.sh` | EC2 instance initialization script |
| `scripts/daily-healthcheck.sh` | Automated daily health check |
| `terraform/` | All infrastructure as code |
| `terraform/projects/insighta/environments/prod/` | Insighta production Terraform configuration |
| `terraform/projects/_template/` | Template for new projects |
| `terraform/global/state-backend/` | Bootstrap: remote state backend |
| `terraform/global/iam-ci/` | Bootstrap: GitHub Actions IAM user |
| `prisma/schema.prisma` | Database schema |
| `prisma/migrations/rls_policies.sql` | Row-level security policies |
| `.env.production.example` | Environment variable template |
| `supabase/functions/` | Edge Function source (deployed to Supabase Cloud) |

## Reference: Quick Access URLs

| Resource | URL |
|----------|-----|
| Production site | https://insighta.one |
| API documentation (Swagger) | https://insighta.one/documentation |
| API documentation (Scalar) | https://insighta.one/api-reference |
| Health endpoint | https://insighta.one/health |
| GitHub repository | https://github.com/JK42JJ/insighta |
| GitHub Actions | https://github.com/JK42JJ/insighta/actions |
| GitHub Secrets | https://github.com/JK42JJ/insighta/settings/secrets/actions |
| Supabase dashboard | https://supabase.com/dashboard/project/rckkhhjanqgaopynhfgd |
| AWS EC2 console | https://us-west-2.console.aws.amazon.com/ec2 |
| Google Cloud Console | https://console.cloud.google.com |
| GoDaddy DNS | https://dcc.godaddy.com |
