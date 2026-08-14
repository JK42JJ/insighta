output "ci_user_name" {
  description = "IAM user GitHub Actions authenticates as."
  value       = aws_iam_user.ci.name
}

output "ci_user_arn" {
  description = "Its ARN, for policies that need to name it."
  value       = aws_iam_user.ci.arn
}
