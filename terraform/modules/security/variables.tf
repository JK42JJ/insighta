variable "vpc_id" {
  description = "VPC ID to create the security group in"
  type        = string
}

variable "name_prefix" {
  description = "Prefix for security group name"
  type        = string
}

variable "ingress_rules" {
  description = "List of ingress rules"
  type = list(object({
    port = number
    cidr = string
    desc = string
  }))
  default = []
}

variable "tags" {
  description = "Additional tags"
  type        = map(string)
  default     = {}
}
