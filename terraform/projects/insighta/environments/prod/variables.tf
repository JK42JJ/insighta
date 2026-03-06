variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "ami_id" {
  description = "Ubuntu 22.04 LTS AMI ID for us-west-2"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t2.micro"
}

variable "key_name" {
  description = "SSH key pair name"
  type        = string
  default     = "prx01-tubearchive"
}

variable "domain" {
  description = "Application domain"
  type        = string
  default     = "insighta.one"
}

variable "root_volume_size" {
  description = "Root EBS volume size in GB"
  type        = number
  default     = 8
}

variable "enable_ssm" {
  description = "Enable SSM Session Manager"
  type        = bool
  default     = false
}

variable "enable_cloudwatch" {
  description = "Enable CloudWatch monitoring agent"
  type        = bool
  default     = false
}
