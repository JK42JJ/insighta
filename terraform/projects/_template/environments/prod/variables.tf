variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
}

variable "ami_id" {
  description = "Ubuntu 22.04 LTS AMI ID"
  type        = string
}

variable "instance_type" {
  type    = string
  default = "t2.micro"
}

variable "key_name" {
  description = "SSH key pair name"
  type        = string
}

variable "domain" {
  description = "Application domain"
  type        = string
}
