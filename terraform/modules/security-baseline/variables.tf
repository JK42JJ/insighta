variable "name_prefix" {
  description = "Prefix for every named resource in this module."
  type        = string
}

variable "audit_bucket_name" {
  description = "Bucket that receives CloudTrail (and, when enabled, AWS Config) deliveries."
  type        = string
}

variable "audit_retention_days" {
  description = "Days before an audit object expires. Versioning keeps overwritten history until then as well."
  type        = number
  default     = 365
}

variable "log_retention_days" {
  description = "Retention of the CloudWatch Logs copy of the trail, which the metric alarms read."
  type        = number
  default     = 90
}

variable "alert_email" {
  description = "Address subscribed to the security alert topic. Empty creates the topic with no subscription; subscribe from the console instead."
  type        = string
  default     = ""
}

variable "mfa_required_users" {
  description = "IAM user names that get the RequireMFA policy. Empty attaches nothing. Add a user only after that user has registered an MFA device, or the console session is cut off from everything except MFA setup."
  type        = list(string)
  default     = []
}

variable "unauthorized_calls_threshold" {
  description = "AccessDenied / UnauthorizedOperation events in five minutes before the alarm fires. Above the noise of a CI plan that hits one missing grant, below what a stolen key probing the account produces."
  type        = number
  default     = 10
}

variable "enable_guardduty" {
  description = "Create the GuardDuty detector. The only line item here with a recurring charge after its 30-day trial."
  type        = bool
  default     = true
}

variable "enable_config" {
  description = "Stage 3 (design section 5): the Config recorder, its thirteen rules and the three remediation targets. Off at this scale; the rules would restate what the measurement already showed."
  type        = bool
  default     = false
}

variable "enable_securityhub" {
  description = "Stage 3: Security Hub with the Foundational Security Best Practices standard. Requires enable_config."
  type        = bool
  default     = false
}

variable "access_key_max_age_days" {
  description = "Age at which an active access key is reported by the access-keys-rotated rule (Config only)."
  type        = number
  default     = 90
}

variable "unused_credentials_days" {
  description = "Days without use after which a password or key is reported by the unused-credentials rule (Config only)."
  type        = number
  default     = 90
}

variable "auto_remediate_open_ssh" {
  description = "Config only. Revoke 0.0.0.0/0 on port 22 automatically when the restricted-ssh rule fails."
  type        = bool
  default     = true
}

variable "auto_remediate_public_s3" {
  description = "Config only. Apply a private ACL and public access block automatically when a bucket allows public reads. Off until the non-Insighta bucket in this account has been checked."
  type        = bool
  default     = false
}

variable "auto_deactivate_stale_keys" {
  description = "Config only. Deactivate access keys older than access_key_max_age_days automatically. Off until CI runs on OIDC."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to taggable resources."
  type        = map(string)
  default     = {}
}
