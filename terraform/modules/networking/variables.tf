variable "vpc_id" {
  description = "VPC to use. Empty selects the account's default VPC, which is what prod runs in today."
  type        = string
  default     = ""
}
