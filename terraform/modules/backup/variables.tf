variable "bucket_name" {
  description = "Name of the S3 bucket for backups"
  type        = string
}

variable "retention_days" {
  description = "Number of days to retain backups before expiration"
  type        = number
  default     = 30
}

variable "transition_days" {
  description = "Number of days before transitioning to Standard-IA"
  type        = number
  default     = 7
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
