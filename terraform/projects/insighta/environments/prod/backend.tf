terraform {
  backend "s3" {
    bucket         = "insighta-terraform-state"
    key            = "projects/insighta/prod/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "insighta-terraform-lock"
    encrypt        = true
  }
}
