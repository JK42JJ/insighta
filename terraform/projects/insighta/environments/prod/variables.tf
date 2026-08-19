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

variable "enable_prod_instance" {
  description = <<-EOT
    Create the original production EC2 instance. Default true so adding the
    variable does not change anyone else's plan; production sets it to false,
    having moved to the cluster on 2026-08-14 and kept this host as a rollback
    target until 2026-08-19.

    The service Elastic IP is not affected. It was moved out of module.compute
    on the same day precisely so that this flag could be flipped without the
    address going with the instance.
  EOT
  type        = bool
  default     = true
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
  description = <<-EOT
    Instance type for the k3s node.

    t3.small carried the validation cluster at 73% of 1910 MB with k3s, ArgoCD
    core, four application pods and a development database. That leaves no room
    for traffic, a second replica, or a spike.

    Production runs t3.medium and uses 585 MB of 3836 MB, with the three
    containers totalling 182 MiB. Matching it removes node size as a variable
    when comparing the two during the parallel run.
  EOT
  type        = string
  default     = "t3.medium"
}

variable "k3s_instance_profile" {
  description = "Existing instance profile for the k3s node. Empty disables the attachment."
  type        = string
  default     = "insighta-k3s-node"
}

variable "k3s_node_count" {
  description = <<-EOT
    Number of k3s nodes.

    Two while the architecture is verified and operated by hand, so that
    scheduling, draining and rescheduling are observed rather than read about.
    Planned reduction to one on 2026-09-14.

    This is not high availability. The control plane, the ingress and the
    Elastic IP all stay on the first node, so losing it still takes the service
    down regardless of how many nodes exist.
  EOT
  type        = number
  default     = 1
}

variable "k3s_extra_instance_type" {
  description = <<-EOT
    Size of nodes after the first.

    Measured requirement for an agent running one api and one frontend pod:
    180 MB operating system, 230 MB agent and containerd, 177 MB api, 6 MB
    frontend -- about 593 MB, or 31% of what t3a.small provides. Under the
    api container's 512 Mi limit it reaches 49%.

    t3a.small rather than t3.small: same x86 architecture, so the existing
    amd64 images run unchanged, at $13.70 a month against $15.20. t4g.small is
    cheaper still at $12.30 but is ARM, and deploy.yml builds no arm64 image.
  EOT
  type        = string
  default     = "t3a.small"
}

