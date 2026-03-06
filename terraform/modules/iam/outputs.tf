output "instance_profile_name" {
  description = "Instance profile name"
  value       = aws_iam_instance_profile.ec2.name
}

output "role_arn" {
  description = "IAM role ARN"
  value       = aws_iam_role.ec2.arn
}
