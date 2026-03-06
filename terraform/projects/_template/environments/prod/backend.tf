# Update the key to match your project name
terraform {
  backend "s3" {
    bucket         = "insighta-terraform-state"
    key            = "projects/CHANGE_ME/prod/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "insighta-terraform-lock"
    encrypt        = true
  }
}
