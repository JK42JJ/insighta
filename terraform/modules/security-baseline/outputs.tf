output "trail_arn" {
  value = aws_cloudtrail.main.arn
}

output "audit_bucket" {
  value = aws_s3_bucket.audit.id
}

output "trail_log_group" {
  value = aws_cloudwatch_log_group.trail.name
}

output "guardduty_detector_id" {
  value = try(aws_guardduty_detector.main[0].id, null)
}

output "access_analyzer_arn" {
  value = aws_accessanalyzer_analyzer.account.arn
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "require_mfa_policy_arn" {
  value = aws_iam_policy.require_mfa.arn
}

output "config_recorder" {
  value = try(aws_config_configuration_recorder.main[0].name, null)
}

output "securityhub_arn" {
  value = try(aws_securityhub_account.main[0].arn, null)
}
