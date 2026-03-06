# Insighta Production Environment
# Manages: EC2, EIP, Security Group, IAM

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Networking (Default VPC) ---
module "networking" {
  source          = "../../../../modules/networking"
  use_default_vpc = true
}

# --- Security Group ---
module "security" {
  source      = "../../../../modules/security"
  vpc_id      = module.networking.vpc_id
  name_prefix = "insighta"

  ingress_rules = [
    { port = 22, cidr = "0.0.0.0/0", desc = "SSH" },
    { port = 80, cidr = "0.0.0.0/0", desc = "HTTP" },
    { port = 443, cidr = "0.0.0.0/0", desc = "HTTPS" },
  ]

  tags = {
    Project     = "insighta"
    Environment = "production"
  }
}

# --- IAM ---
module "iam" {
  source            = "../../../../modules/iam"
  role_name         = "insighta"
  enable_ssm        = var.enable_ssm
  enable_cloudwatch = var.enable_cloudwatch
}

# --- Compute (EC2 + EIP) ---
module "compute" {
  source        = "../../../../modules/compute"
  instance_name = "insighta-prod"
  instance_type = var.instance_type
  ami_id        = var.ami_id
  key_name      = var.key_name
  subnet_id     = module.networking.subnet_id

  security_group_ids   = [module.security.sg_id]
  iam_instance_profile = module.iam.instance_profile_name
  root_volume_size     = var.root_volume_size
  create_eip           = true

  user_data_vars = {
    app_name  = "insighta"
    app_dir   = "/opt/tubearchive"
    swap_size = "2G"
    domain    = var.domain
  }

  tags = {
    Project     = "insighta"
    Environment = "production"
  }
}

# --- Backup (S3) ---
module "backup" {
  source          = "../../../../modules/backup"
  bucket_name     = "insighta-backups"
  retention_days  = 30
  transition_days = 7

  tags = {
    Project     = "insighta"
    Environment = "production"
  }
}
