output "vpc_id" {
  description = "VPC ID"
  value       = var.use_default_vpc ? data.aws_vpc.default[0].id : null
}

output "subnet_ids" {
  description = "Subnet IDs"
  value       = var.use_default_vpc ? data.aws_subnets.default[0].ids : []
}

output "subnet_id" {
  description = "First subnet ID (for single-instance deployments)"
  value       = var.use_default_vpc ? data.aws_subnets.default[0].ids[0] : null
}
