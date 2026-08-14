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

  name               = "insighta-prod"
  ami_id             = var.ami_id
  instance_type      = var.instance_type
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

  name          = "insighta-k3s-1"
  ami_id        = var.ami_id
  instance_type = var.k3s_instance_type
  key_name      = var.key_name
  subnet_id     = local.subnet_id
  vpc_id        = module.networking.vpc_id

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
