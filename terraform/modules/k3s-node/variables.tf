variable "name" {
  description = "Instance name tag."
  type        = string
}

variable "ami_id" {
  description = "AMI to launch. Pinned, like the production instance -- a newer default image would replace the node."
  type        = string
}

variable "instance_type" {
  description = <<-EOT
    t3.small (2 vCPU / 2 GiB) is the measured fit for a validation cluster:

      k3s server (control plane + datastore)   ~500-700 MB
      system                                    ~200 MB
      application pods (measured 191 MB + worker) ~250 MB
      headroom                                  ~600-800 MB

    It is not sized to serve traffic. Production runs t3.medium with 2,971 MB
    available, roughly five times this node's headroom.
  EOT
  type        = string
  default     = "t3.small"
}

variable "key_name" {
  description = "Existing EC2 key pair for SSH."
  type        = string
}

variable "subnet_id" {
  description = "Subnet to launch in. Same subnet as production so latency to Supabase matches."
  type        = string
}

variable "security_group_ids" {
  description = "Extra security groups beyond the node's own. Usually empty."
  type        = list(string)
  default     = []
}

variable "root_volume_size" {
  description = "Root volume in GB. k3s plus container images take roughly 3 GB; 20 leaves room for images accumulating between prunes."
  type        = number
  default     = 20
}

variable "tags" {
  description = "Tags applied to the instance and its volume."
  type        = map(string)
  default     = {}
}

variable "vpc_id" {
  description = "VPC to create the node's security group in."
  type        = string
}

variable "ssh_cidrs" {
  description = <<-EOT
    Standing port-22 sources. Empty by default and expected to stay empty:
    access is opened at connect time by the same script that reaches the
    production host, and left in the code it would be one more entry nobody
    revokes.
  EOT
  type        = list(string)
  default     = []
}
