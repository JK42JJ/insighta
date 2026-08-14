variable "aws_region" {
  description = "Region everything lives in."
  type        = string
  default     = "us-west-2"
}

variable "ami_id" {
  description = "AMI the instance runs."
  type        = string
}

variable "instance_type" {
  description = "Instance size. Keep this equal to the running machine."
  type        = string
}

variable "key_name" {
  description = "EC2 key pair name."
  type        = string
}

variable "domain" {
  description = "Public domain the service answers on."
  type        = string
}

variable "root_volume_size" {
  description = "Root volume size in GiB."
  type        = number
  default     = 20
}

variable "ssh_cidrs" {
  description = "Operator addresses allowed on port 22."
  type        = list(string)
  default     = []
}

variable "enable_ssm" {
  description = "Reserved. SSM is AWS-only and the portability design rejects it; kept so tfvars stays valid."
  type        = bool
  default     = false
}

variable "enable_cloudwatch" {
  description = "Attach the CloudWatch agent policy to the instance role."
  type        = bool
  default     = true
}

variable "backup_bucket_name" {
  description = "Bucket the backup workflows write to."
  type        = string
  default     = "insighta-backups"
}

variable "enable_k3s_node" {
  description = <<-EOT
    Create the k3s validation node. Default false: this is the only variable in
    this stack whose flip costs money, so it is off until someone turns it on
    rather than on until someone notices.
  EOT
  type        = bool
  default     = false
}

variable "k3s_instance_type" {
  description = "Validation node size. See modules/k3s-node for the memory arithmetic behind t3.small."
  type        = string
  default     = "t3.small"
}

variable "k3s_instance_profile" {
  description = "Existing instance profile for the k3s node. Empty disables the attachment."
  type        = string
  default     = "insighta-k3s-node"
}

