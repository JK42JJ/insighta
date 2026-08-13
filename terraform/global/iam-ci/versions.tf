terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.100"
    }
  }

  backend "s3" {
    bucket         = "insighta-terraform-state"
    key            = "global/iam-ci/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "insighta-terraform-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = "us-west-2"
}
