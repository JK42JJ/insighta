output "instance_profile_name" {
  description = "Instance profile to attach to the EC2 instance."
  value       = aws_iam_instance_profile.ec2.name
}

output "role_arn" {
  description = "Role ARN, for policies that need to name it."
  value       = aws_iam_role.ec2.arn
}
