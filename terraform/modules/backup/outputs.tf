output "bucket_name" {
  description = "Backup bucket name, as used by the backup workflows."
  value       = aws_s3_bucket.backups.id
}

output "bucket_arn" {
  description = "Backup bucket ARN."
  value       = aws_s3_bucket.backups.arn
}
