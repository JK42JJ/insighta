# Read access the CI identity needs to plan, refresh and drift-check the
# security baseline module (CloudTrail, CloudWatch, GuardDuty, Access
# Analyzer, SNS, EventBridge, the audit bucket, and the Stage 3 services).
# Reads only: the baseline itself is applied by an operator, and a CI
# identity that could create trails or roles would be a larger surface than
# the drift check is worth.
resource "aws_iam_policy" "ci_security_read" {
  name        = "insighta-ci-security-read"
  description = "Read-only access for planning and drift-checking the security baseline."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecurityServicesRead"
        Effect = "Allow"
        Action = [
          "cloudtrail:DescribeTrails", "cloudtrail:GetTrail", "cloudtrail:GetTrailStatus",
          "cloudtrail:GetEventSelectors", "cloudtrail:GetInsightSelectors", "cloudtrail:ListTags",
          "guardduty:GetDetector", "guardduty:ListDetectors", "guardduty:ListTagsForResource",
          "access-analyzer:GetAnalyzer", "access-analyzer:ListAnalyzers",
          "sns:GetTopicAttributes", "sns:GetSubscriptionAttributes", "sns:ListTagsForResource",
          "logs:DescribeLogGroups", "logs:DescribeMetricFilters", "logs:ListTagsForResource", "logs:ListTagsLogGroup",
          "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource",
          "events:DescribeRule", "events:ListTargetsByRule", "events:ListTagsForResource",
          "iam:GetAccountPasswordPolicy", "ec2:GetEbsEncryptionByDefault",
          "iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "iam:ListEntitiesForPolicy",
          "iam:ListAttachedUserPolicies", "iam:GetUserPolicy", "iam:ListUserPolicies",
          "iam:GenerateCredentialReport", "iam:GetCredentialReport", "iam:ListUsers", "iam:ListMFADevices", "iam:ListAccessKeys", "iam:GetAccessKeyLastUsed",
          "config:DescribeConfigurationRecorders", "config:DescribeConfigurationRecorderStatus",
          "config:DescribeDeliveryChannels", "config:DescribeConfigRules",
          "config:DescribeRemediationConfigurations", "config:ListTagsForResource",
          "securityhub:DescribeHub", "securityhub:GetEnabledStandards",
          "ssm:GetDocument", "ssm:DescribeDocument", "ssm:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "AuditBucketRead"
        Effect = "Allow"
        Action = [
          "s3:ListBucket", "s3:GetBucketLocation", "s3:GetBucketVersioning", "s3:GetBucketPolicy",
          "s3:GetBucketPolicyStatus", "s3:GetBucketPublicAccessBlock", "s3:GetBucketAcl",
          "s3:GetBucketCORS", "s3:GetBucketWebsite", "s3:GetBucketLogging", "s3:GetBucketTagging",
          "s3:GetBucketRequestPayment", "s3:GetBucketObjectLockConfiguration", "s3:GetBucketOwnershipControls",
          "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration",
          "s3:GetAccelerateConfiguration", "s3:GetBucketNotification",
        ]
        Resource = ["arn:aws:s3:::insighta-audit-logs"]
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_security_read" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.ci_security_read.arn
}
