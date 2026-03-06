# Project Template - Copy this directory for new projects
# Steps:
#   1. cp -r _template/ <project-name>/
#   2. Edit terraform.tfvars with project-specific values
#   3. Update backend.tf with unique state key
#   4. terraform init && terraform plan && terraform apply

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

module "networking" {
  source          = "../../../../modules/networking"
  use_default_vpc = true
}

module "security" {
  source      = "../../../../modules/security"
  vpc_id      = module.networking.vpc_id
  name_prefix = var.project_name

  ingress_rules = [
    { port = 22, cidr = "0.0.0.0/0", desc = "SSH" },
    { port = 80, cidr = "0.0.0.0/0", desc = "HTTP" },
    { port = 443, cidr = "0.0.0.0/0", desc = "HTTPS" },
  ]

  tags = {
    Project     = var.project_name
    Environment = "production"
  }
}

module "iam" {
  source    = "../../../../modules/iam"
  role_name = var.project_name
}

module "compute" {
  source        = "../../../../modules/compute"
  instance_name = "${var.project_name}-prod"
  instance_type = var.instance_type
  ami_id        = var.ami_id
  key_name      = var.key_name
  subnet_id     = module.networking.subnet_id

  security_group_ids   = [module.security.sg_id]
  iam_instance_profile = module.iam.instance_profile_name
  create_eip           = true

  user_data_vars = {
    app_name  = var.project_name
    app_dir   = "/opt/${var.project_name}"
    swap_size = "2G"
    domain    = var.domain
  }

  tags = {
    Project     = var.project_name
    Environment = "production"
  }
}
