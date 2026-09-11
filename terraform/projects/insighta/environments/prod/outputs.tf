# These four are what the state already publishes. Adding more is safe — an
# output is not infrastructure — but keeping the set identical is what makes
# "No changes" an unambiguous statement rather than one with a footnote.
output "instance_id" {
  description = "Production EC2 instance."
  value       = one(module.compute[*].instance_id)
}

output "instance_profile" {
  description = "IAM instance profile attached to it."
  value       = module.iam.instance_profile_name
}

output "public_ip" {
  description = "Elastic IP. This is the address in DNS and in the SSH allowlists."
  value       = aws_eip.service.public_ip
}

output "security_group_id" {
  description = "Security group the deploy and backup jobs open port 22 on."
  value       = module.security.security_group_id
}

output "security_alerts_topic_arn" {
  description = "SNS topic that receives GuardDuty, Security Hub and Config alerts. Null until the baseline is enabled."
  value       = try(module.security_baseline[0].alerts_topic_arn, null)
}
