variable "name_prefix" {
  description = "Prefix for every named resource in this module."
  type        = string
}

variable "audit_bucket_name" {
  description = "Bucket that receives CloudTrail and AWS Config deliveries."
  type        = string
}

variable "audit_retention_days" {
  description = "Days before an audit object expires. Versioning keeps overwritten history until then as well."
  type        = number
  default     = 365
}

variable "alert_email" {
  description = "Address subscribed to the security alert topic. Empty creates the topic with no subscription; subscribe from the console instead."
  type        = string
  default     = ""
}

variable "access_key_max_age_days" {
  description = "Age at which an active access key is reported by the access-keys-rotated rule."
  type        = number
  default     = 90
}

variable "unused_credentials_days" {
  description = "Days without use after which a password or key is reported by the unused-credentials rule."
  type        = number
  default     = 90
}

variable "enable_guardduty" {
  description = "Create the GuardDuty detector. The only line item here with a recurring charge after its 30-day trial."
  type        = bool
  default     = true
}

variable "enable_securityhub" {
  description = "Enable Security Hub with the AWS Foundational Security Best Practices standard."
  type        = bool
  default     = true
}

variable "auto_remediate_open_ssh" {
  description = "Revoke 0.0.0.0/0 on port 22 automatically when the restricted-ssh rule fails. Nothing in this system is meant to expose SSH to the world, so this one acts on its own."
  type        = bool
  default     = true
}

variable "auto_remediate_public_s3" {
  description = "Apply a private ACL and public access block automatically when a bucket allows public reads. Off until the non-Insighta bucket in this account has been checked, because the remediation would act on it too."
  type        = bool
  default     = false
}

variable "auto_deactivate_stale_keys" {
  description = "Deactivate access keys older than access_key_max_age_days automatically. Off until CI runs on OIDC: today both the CI key and the operator key are past the limit and would be cut on the first evaluation."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to taggable resources."
  type        = map(string)
  default     = {}
}
