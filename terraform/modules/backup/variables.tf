variable "bucket_name" {
  description = "Backup bucket name."
  type        = string
}

variable "retention_days" {
  description = "Days before an object expires. The workflows also prune at 30; this is the backstop."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Tags applied to the bucket."
  type        = map(string)
  default     = {}
}

variable "transition_ia_days" {
  description = "Days before an object moves to STANDARD_IA."
  type        = number
  default     = 30
}
