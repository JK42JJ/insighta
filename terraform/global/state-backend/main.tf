# Global State Backend Bootstrap
# Run once locally: terraform init && terraform apply
# After creation, migrate state to S3 by adding backend config

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
  region = "us-west-2"
}

module "state_backend" {
  source = "../../modules/state-backend"

  bucket_name         = "insighta-terraform-state"
  dynamodb_table_name = "insighta-terraform-lock"
  region              = "us-west-2"
}

output "bucket_name" {
  value = module.state_backend.bucket_name
}

output "dynamodb_table_name" {
  value = module.state_backend.dynamodb_table_name
}
