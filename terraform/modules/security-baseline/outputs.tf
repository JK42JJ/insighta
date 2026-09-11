output "trail_arn" {
  value = aws_cloudtrail.main.arn
}

output "audit_bucket" {
  value = aws_s3_bucket.audit.id
}

output "config_recorder" {
  value = aws_config_configuration_recorder.main.name
}

output "guardduty_detector_id" {
  value = try(aws_guardduty_detector.main[0].id, null)
}

output "securityhub_arn" {
  value = try(aws_securityhub_account.main[0].arn, null)
}

output "access_analyzer_arn" {
  value = aws_accessanalyzer_analyzer.account.arn
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "remediation_role_arn" {
  value = aws_iam_role.remediation.arn
}
