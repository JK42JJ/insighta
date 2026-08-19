output "instance_id" {
  description = "EC2 instance id."
  value       = aws_instance.this.id
}


output "private_ip" {
  description = "Private address inside the VPC."
  value       = aws_instance.this.private_ip
}
