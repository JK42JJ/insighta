output "vpc_id" {
  description = "VPC the workload runs in."
  value       = data.aws_vpc.default.id
}

output "vpc_cidr" {
  description = "VPC CIDR. Worth reading before choosing any overlay or Docker address pool."
  value       = data.aws_vpc.default.cidr_block
}

output "subnet_ids" {
  description = "All subnets in the VPC, ordered as the API returns them."
  value       = data.aws_subnets.default.ids
}
