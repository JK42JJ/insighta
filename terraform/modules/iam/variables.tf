variable "name" {
  description = "Base name for the role and instance profile."
  type        = string
  default     = "insighta-ec2"
}

variable "enable_cloudwatch" {
  description = "Attach CloudWatchAgentServerPolicy so the agent can publish metrics."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to the role."
  type        = map(string)
  default     = {}
}
