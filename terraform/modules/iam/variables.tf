variable "role_name" {
  description = "Base name for IAM resources"
  type        = string
}

variable "enable_ssm" {
  description = "Enable SSM Session Manager access"
  type        = bool
  default     = false
}

variable "enable_cloudwatch" {
  description = "Enable CloudWatch agent access"
  type        = bool
  default     = false
}
