# Production. One instance, one address, one bucket — reconstructed from the
# remote state after the .tf files that created it were lost from the repo.
#
# Module names and resource addresses here are not free choices: they have to
# match what the state already records (module.networking, module.security,
# module.iam, module.compute, module.backup) or Terraform reads every resource
# as new and proposes destroying the originals.

module "networking" {
  source = "../../../../modules/networking"
}

module "security" {
  source = "../../../../modules/security"

  vpc_id    = module.networking.vpc_id
  ssh_cidrs = var.ssh_cidrs
  tags      = merge(local.common_tags, { Name = "insighta-sg" })
}

module "iam" {
  source = "../../../../modules/iam"

  name              = "insighta-ec2"
  enable_cloudwatch = var.enable_cloudwatch
  tags              = { ManagedBy = "terraform" }
}

module "compute" {
  source = "../../../../modules/compute"

  name          = "insighta-prod"
  ami_id        = var.ami_id
  instance_type = var.instance_type

  # The service address now answers from the cluster. Declared here rather than
  # left as drift: terraform.yml applies on every push to main, and a plan that
  # still believed the address belonged to this instance would move it back --
  # silently, as a side effect of an unrelated merge.
  eip_instance_id    = var.enable_k3s_node ? module.k3s_node[0].instance_id : ""
  key_name           = var.key_name
  subnet_id          = local.subnet_id
  security_group_ids = [module.security.security_group_id]
  instance_profile   = module.iam.instance_profile_name
  root_volume_size   = var.root_volume_size
  tags               = local.common_tags
}

# The k3s validation node (P2). Separate instance, no traffic, no DNS.
#
# Sized for validation rather than service: t3.small leaves roughly 600-800 MB
# after k3s and the application pods, against production's 2,971 MB. It exists
# so the cluster can be built and broken without the machine that serves the
# site being involved.
#
# enable_k3s_node = false by default. Nothing is created until it is set, so
# this module costs nothing until someone decides to spend.
module "k3s_node" {
  source = "../../../../modules/k3s-node"
  count  = var.enable_k3s_node ? 1 : 0

  name                 = "insighta-k3s"
  iam_instance_profile = var.k3s_instance_profile
  ami_id               = var.ami_id
  node_count           = var.k3s_node_count
  extra_instance_type  = var.k3s_extra_instance_type
  instance_type        = var.k3s_instance_type
  key_name             = var.key_name
  subnet_id            = local.subnet_id
  vpc_id               = module.networking.vpc_id

  tags = merge(local.common_tags, { Phase = "P2" })
}

module "backup" {
  source = "../../../../modules/backup"

  bucket_name = var.backup_bucket_name

  # No ManagedBy here: the bucket in state does not carry one, and adding it
  # would be a change for its own sake.
  tags = {
    Environment = "production"
    Project     = "insighta"
    Purpose     = "database-backups"
  }
}

# The instance sits in us-west-2c. Sorting the subnet list makes the choice
# reproducible instead of depending on the order the API happens to return.
locals {
  subnet_id = "subnet-078ceadcd43263636"

  common_tags = {
    Environment = "production"
    ManagedBy   = "terraform"
    Project     = "insighta"
  }
}

# ── Container images ────────────────────────────────────────────────────────
#
# The cluster could not pull ghcr.io/jk42jj/* because those packages are
# private and no long-lived credential for them exists: the token stored on the
# production box is a CI GITHUB_TOKEN and was measured expired (401) on
# 2026-08-14. Handing a personal access token to a cluster replaces that with a
# secret that has to be rotated and cannot be revoked without breaking pulls.
#
# ECR removes the credential instead of managing it. The node carries an
# instance profile with ECR read; the kubelet authenticates with it and there
# is no pull secret in any namespace. GHCR keeps receiving the same images, so
# the compose host is untouched.
#
# Storage is bounded to the last 5 tags per repository -- roughly 2 GB, about
# $0.20 a month at us-west-2 rates.
resource "aws_ecr_repository" "images" {
  for_each = toset(["insighta-api", "insighta-frontend", "insighta-redis"])

  name                 = each.key
  image_tag_mutability = "MUTABLE" # :latest is expected to move

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each   = aws_ecr_repository.images
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 5 images; older tags are reachable by digest in the deploy log if ever needed."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

output "ecr_registry" {
  description = "Registry host for the image repositories."
  value       = split("/", values(aws_ecr_repository.images)[0].repository_url)[0]
}

# ── Standby address for the former edge ─────────────────────────────────────
#
# insighta-prod carried the service address until 2026-08-14. When that address
# moved to the cluster, the host was left with no public IP at all -- and this
# subnet routes through an internet gateway, not a NAT, so no public IP means
# no outbound internet.
#
# That matters because the host is the rollback target. Its containers talk to
# Supabase; without egress they fail their health checks, and a rollback to a
# stack that has been failing for two weeks is not a rollback anyone should
# trust.
#
# Roughly $3.60/month, and it is released when the host is decommissioned.
resource "aws_eip" "prod_standby" {
  count  = var.enable_k3s_node ? 1 : 0
  domain = "vpc"
  tags   = merge(local.common_tags, { Name = "insighta-prod-standby-eip" })
}

resource "aws_eip_association" "prod_standby" {
  count         = var.enable_k3s_node ? 1 : 0
  instance_id   = module.compute.instance_id
  allocation_id = aws_eip.prod_standby[0].id
}
