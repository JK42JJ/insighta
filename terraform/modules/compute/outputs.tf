output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.this.id
}

output "instance_public_ip" {
  description = "Public IP (EIP if created, otherwise instance IP)"
  value       = var.create_eip ? aws_eip.this[0].public_ip : aws_instance.this.public_ip
}

output "eip_allocation_id" {
  description = "EIP allocation ID"
  value       = var.create_eip ? aws_eip.this[0].id : null
}

output "instance_private_ip" {
  description = "Private IP"
  value       = aws_instance.this.private_ip
}
