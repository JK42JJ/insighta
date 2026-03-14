# Terraform Infrastructure

Insighta infrastructure as code using reusable Terraform modules.

## Directory Structure

```
terraform/
  modules/           # Reusable modules (shared across all projects)
    networking/      # VPC, subnets (Phase 1: default VPC)
    security/        # Security groups with variable ingress rules
    compute/         # EC2, EIP, cloud-init
    iam/             # IAM roles, instance profiles
    state-backend/   # S3 + DynamoDB for remote state
  projects/
    insighta/environments/prod/   # Insighta production
    _template/                    # Copy for new projects
  global/
    state-backend/   # Bootstrap (run once)
    iam-ci/          # GitHub Actions IAM user
```

## Quick Start

### 1. Bootstrap State Backend (one-time)

```bash
cd terraform/global/state-backend
terraform init
terraform apply
```

### 2. Import Existing Resources

```bash
cd terraform/projects/insighta/environments/prod
cp terraform.tfvars.example terraform.tfvars
# Fill in ami_id and other values

terraform init
terraform import module.compute.aws_instance.this i-XXXXXXXXXXXX
terraform import module.compute.aws_eip.this eipalloc-XXXXXXXXXXXX
terraform import module.security.aws_security_group.this sg-XXXXXXXXXXXX
terraform plan  # Should show "No changes"
```

### 3. New Project

```bash
cp -r terraform/projects/_template terraform/projects/my-project
# Edit backend.tf (change state key)
# Edit terraform.tfvars
terraform init && terraform apply
```

## CI/CD

- **PR**: `terraform plan` runs automatically, result posted as PR comment
- **Merge to main**: `terraform apply` with manual approval (production environment)
- Trigger: changes in `terraform/**` path only

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `TF_AWS_ACCESS_KEY_ID` | CI IAM user access key |
| `TF_AWS_SECRET_ACCESS_KEY` | CI IAM user secret key |
