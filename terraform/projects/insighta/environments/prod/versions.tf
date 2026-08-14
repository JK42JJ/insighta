terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
  }

  # The bucket and lock table were created by terraform/global/state-backend and
  # are the only pieces of this system that predate the code being lost.
  backend "s3" {
    bucket         = "insighta-terraform-state"
    key            = "projects/insighta/prod/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "insighta-terraform-lock"
    encrypt        = true
  }
}

# default_tags is deliberately not used. The resources in state carry their tags
# individually and not uniformly — the backup bucket has Purpose but no
# ManagedBy, the IAM role has only ManagedBy — so a provider-wide default would
# rewrite every one of them on the first apply. Matching what exists is worth
# more here than tidiness.
provider "aws" {
  region = var.aws_region
}
