output "ci_user_name" {
  description = "IAM user GitHub Actions authenticates as."
  value       = aws_iam_user.ci.name
}

output "ci_user_arn" {
  description = "Its ARN, for policies that need to name it."
  value       = aws_iam_user.ci.arn
}

output "github_actions_role_arn" {
  description = "Role for GitHub Actions to assume via OIDC. Store it as the AWS_ROLE_ARN repository secret; it contains the account id and this repository is public."
  value       = aws_iam_role.github_actions.arn
  sensitive   = true
}
