output "instance_id" {
  description = "EC2 instance ID"
  value       = module.compute.instance_id
}

output "public_ip" {
  description = "Elastic IP address"
  value       = module.compute.instance_public_ip
}

output "security_group_id" {
  description = "Security group ID"
  value       = module.security.sg_id
}

output "instance_profile" {
  description = "IAM instance profile name"
  value       = module.iam.instance_profile_name
}
