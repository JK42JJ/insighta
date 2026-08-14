output "instance_id" {
  description = "Instance id."
  value       = aws_instance.this[0].id
}

output "private_ip" {
  description = "Private address. Preferred for anything inside the VPC."
  value       = aws_instance.this[0].private_ip
}

output "public_ip" {
  description = "Public address. Changes on stop/start -- no EIP is attached."
  value       = aws_instance.this[0].public_ip
}

output "security_group_id" {
  description = "The node's own security group."
  value       = aws_security_group.this.id
}

output "instance_ids" {
  description = "All node instance ids, in index order."
  value       = aws_instance.this[*].id
}

output "private_ips" {
  description = "All node private addresses, in index order."
  value       = aws_instance.this[*].private_ip
}

