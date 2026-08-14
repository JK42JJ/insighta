variable "node_count" {
  description = <<-EOT
    How many nodes this module creates. Names are suffixed with the index.

    Two exists for a fixed reason and a fixed period: to run the application
    across separate machines while the architecture is being verified and
    operated by hand, so that scheduling, draining and rescheduling can be
    observed rather than read about.

    Planned reduction to one on 2026-09-14. This is not a high-availability
    configuration and adding a node does not make it one -- the control plane,
    the ingress and the Elastic IP all remain on the first node.
  EOT
  type        = number
  default     = 1
}

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

variable "iam_instance_profile" {
  description = <<-EOT
    Name of an existing instance profile to attach, or "" for none.

    Deliberately a name rather than a managed resource. Creating the role here
    would require CI's terraform principal to hold iam:CreateRole, which is the
    standard path from "CI can deploy" to "CI can mint an administrator". The
    role and profile are created once by an administrator; terraform attaches
    what already exists and CI holds only iam:PassRole for that one ARN.
  EOT
  type        = string
  default     = ""
}

variable "extra_instance_type" {
  description = "Size for nodes after the first. The first carries the control plane and is sized separately."
  type        = string
  default     = ""
}

