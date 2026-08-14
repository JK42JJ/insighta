variable "name_prefix" {
  description = "Prefix for the generated security group name."
  type        = string
  default     = "insighta-sg-"
}

variable "vpc_id" {
  description = "VPC the group belongs to."
  type        = string
}

variable "ssh_cidrs" {
  description = "Addresses allowed to reach port 22. Operator IPs only."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to the group."
  type        = map(string)
  default     = {}
}
