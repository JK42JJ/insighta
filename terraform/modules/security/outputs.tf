output "sg_id" {
  description = "Security group ID"
  value       = aws_security_group.this.id
}

output "sg_name" {
  description = "Security group name"
  value       = aws_security_group.this.name
}
