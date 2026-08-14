variable "name" {
  description = "Name tag for the instance."
  type        = string
  default     = "insighta-prod"
}

variable "ami_id" {
  description = "AMI to run."
  type        = string
}

variable "instance_type" {
  description = "Instance size. Must match reality — see the note in main.tf."
  type        = string
}

variable "key_name" {
  description = "EC2 key pair for the initial SSH path."
  type        = string
}

variable "subnet_id" {
  description = "Subnet to place the instance in."
  type        = string
}

variable "security_group_ids" {
  description = "Security groups to attach."
  type        = list(string)
}

variable "instance_profile" {
  description = "IAM instance profile name."
  type        = string
  default     = null
}

variable "root_volume_size" {
  description = "Root volume size in GiB."
  type        = number
  default     = 20
}

variable "root_volume_type" {
  description = "Root volume type."
  type        = string
  default     = "gp2"
}

variable "tags" {
  description = "Tags applied to the instance and EIP."
  type        = map(string)
  default     = {}
}
