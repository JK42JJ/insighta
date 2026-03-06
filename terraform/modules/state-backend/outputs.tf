output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.terraform_state.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.terraform_state.arn
}

output "dynamodb_table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.terraform_locks.name
}
