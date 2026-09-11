# Account-level security baseline. Measured absent on 2026-09-11 (no trail,
# no GuardDuty, no Config, no Security Hub, no Access Analyzer, no password
# policy, EBS default encryption off); design and staging in
# docs/security/cloud-security-architecture-2026-09-11.md.
#
# Stage 1 (always on when the module is enabled):
#   audit bucket, multi-region CloudTrail with a CloudWatch Logs copy, three
#   metric alarms from the CIS benchmark (root use, console login without
#   MFA, unauthorized-call bursts), GuardDuty with every paid plan declared
#   off, Access Analyzer, the account password policy, EBS encryption by
#   default, the RequireMFA policy for named operators, and one SNS topic.
#
# Stage 3 (enable_config / enable_securityhub, off by default):
#   the Config recorder with thirteen managed rules and three remediation
#   targets, and Security Hub. Kept as code so the switch is a flag flip
#   with a plan, not a rewrite.
#
# Cost: none by rule (2026-09-11). The first trail's management events are
# free, the Logs copy and eight alarms sit inside the always-free tier, SNS
# email is free, Access Analyzer is free. GuardDuty, Config and Security Hub
# are declared but off; the detection they would add comes from the trail
# alarms and an open-source posture scan run from CI instead.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
  partition  = data.aws_partition.current.partition
  trail_name = "${var.name_prefix}-trail"
  trail_arn  = "arn:${local.partition}:cloudtrail:${local.region}:${local.account_id}:trail/${local.trail_name}"
  config_on  = var.enable_config
  hub_on     = var.enable_config && var.enable_securityhub
}

# ── Audit bucket ─────────────────────────────────────────────────────────────
# prevent_destroy because an audit trail that a plan can remove is not one.

resource "aws_s3_bucket" "audit" {
  bucket = var.audit_bucket_name
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    id     = "audit-retention"
    status = "Enabled"

    filter {}

    expiration {
      days = var.audit_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

data "aws_iam_policy_document" "audit_bucket" {
  statement {
    sid       = "AWSCloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "AWSCloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/cloudtrail/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }

  statement {
    sid       = "AWSConfigBucketPermissionsCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.audit.arn]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "AWSConfigBucketExistenceCheck"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.audit.arn]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "AWSConfigBucketDelivery"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit.arn}/config/AWSLogs/${local.account_id}/Config/*"]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = data.aws_iam_policy_document.audit_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.audit]
}

# ── CloudTrail → S3 + CloudWatch Logs ────────────────────────────────────────
# S3 is the durable record; the Logs copy exists so metric filters can alarm
# on what the trail sees, across every region, without a second pipeline.

resource "aws_cloudwatch_log_group" "trail" {
  name              = "/aws/cloudtrail/${local.trail_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_iam_role" "trail_logs" {
  name = "${var.name_prefix}-cloudtrail-logs"
  tags = var.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "cloudtrail.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "trail_logs" {
  name = "write-trail-log-group"
  role = aws_iam_role.trail_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.trail.arn}:*"
    }]
  })
}

resource "aws_cloudtrail" "main" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.audit.id
  s3_key_prefix                 = "cloudtrail"
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  enable_logging                = true
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.trail.arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.trail_logs.arn
  tags                          = var.tags

  depends_on = [aws_s3_bucket_policy.audit, aws_iam_role_policy.trail_logs]
}

# CIS benchmark filters on the trail. Each is a question the trail can answer
# that nothing else in the account asks: was root used, did someone log in
# without MFA, is a credential probing what it cannot do, did the identity
# layer, the trail itself, the network shape or a bucket's exposure change.
# Eight alarms; the always-free tier allows ten. Routine port-22 authorize /
# revoke calls from scripts/ops/ssh.sh are deliberately not matched.
locals {
  trail_alarms = {
    iam-policy-changes = {
      pattern     = "{ ($.eventSource = \"iam.amazonaws.com\") && (($.eventName = \"DeleteGroupPolicy\") || ($.eventName = \"DeleteRolePolicy\") || ($.eventName = \"DeleteUserPolicy\") || ($.eventName = \"PutGroupPolicy\") || ($.eventName = \"PutRolePolicy\") || ($.eventName = \"PutUserPolicy\") || ($.eventName = \"CreatePolicy\") || ($.eventName = \"DeletePolicy\") || ($.eventName = \"CreatePolicyVersion\") || ($.eventName = \"DeletePolicyVersion\") || ($.eventName = \"AttachRolePolicy\") || ($.eventName = \"DetachRolePolicy\") || ($.eventName = \"AttachUserPolicy\") || ($.eventName = \"DetachUserPolicy\") || ($.eventName = \"AttachGroupPolicy\") || ($.eventName = \"DetachGroupPolicy\")) }"
      threshold   = 1
      description = "An IAM policy was created, changed, attached or detached."
    }
    cloudtrail-changes = {
      pattern     = "{ ($.eventName = \"CreateTrail\") || ($.eventName = \"UpdateTrail\") || ($.eventName = \"DeleteTrail\") || ($.eventName = \"StartLogging\") || ($.eventName = \"StopLogging\") }"
      threshold   = 1
      description = "The audit trail itself was changed or stopped."
    }
    security-group-structure-changes = {
      pattern     = "{ ($.eventName = \"CreateSecurityGroup\") || ($.eventName = \"DeleteSecurityGroup\") || ($.eventName = \"AuthorizeSecurityGroupEgress\") || ($.eventName = \"RevokeSecurityGroupEgress\") }"
      threshold   = 1
      description = "A security group was created or deleted, or an egress rule changed. Port-22 ingress churn from the SSH helper is excluded on purpose."
    }
    s3-bucket-exposure-changes = {
      pattern     = "{ ($.eventSource = \"s3.amazonaws.com\") && (($.eventName = \"PutBucketAcl\") || ($.eventName = \"PutBucketPolicy\") || ($.eventName = \"DeleteBucketPolicy\") || ($.eventName = \"PutBucketPublicAccessBlock\") || ($.eventName = \"DeletePublicAccessBlock\") || ($.eventName = \"PutBucketCors\") || ($.eventName = \"PutBucketReplication\")) }"
      threshold   = 1
      description = "A bucket's ACL, policy, public-access block or replication changed."
    }
    network-changes = {
      pattern     = "{ ($.eventName = \"CreateRoute\") || ($.eventName = \"CreateRouteTable\") || ($.eventName = \"ReplaceRoute\") || ($.eventName = \"ReplaceRouteTableAssociation\") || ($.eventName = \"DeleteRouteTable\") || ($.eventName = \"DeleteRoute\") || ($.eventName = \"DisassociateRouteTable\") || ($.eventName = \"CreateNetworkAcl\") || ($.eventName = \"CreateNetworkAclEntry\") || ($.eventName = \"DeleteNetworkAcl\") || ($.eventName = \"DeleteNetworkAclEntry\") || ($.eventName = \"ReplaceNetworkAclEntry\") || ($.eventName = \"ReplaceNetworkAclAssociation\") || ($.eventName = \"CreateVpc\") || ($.eventName = \"DeleteVpc\") || ($.eventName = \"ModifyVpcAttribute\") || ($.eventName = \"AttachInternetGateway\") || ($.eventName = \"DetachInternetGateway\") }"
      threshold   = 1
      description = "Route table, network ACL, VPC or internet gateway changed."
    }
    root-account-use = {
      pattern     = "{ $.userIdentity.type = \"Root\" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != \"AwsServiceEvent\" }"
      threshold   = 1
      description = "The root account was used. It should never be."
    }
    console-login-without-mfa = {
      pattern     = "{ ($.eventName = \"ConsoleLogin\") && ($.additionalEventData.MFAUsed != \"Yes\") && ($.userIdentity.type = \"IAMUser\") && ($.responseElements.ConsoleLogin = \"Success\") }"
      threshold   = 1
      description = "An IAM user signed in to the console without MFA."
    }
    unauthorized-api-calls = {
      pattern     = "{ ($.errorCode = \"*UnauthorizedOperation\") || ($.errorCode = \"AccessDenied*\") }"
      threshold   = var.unauthorized_calls_threshold
      description = "A burst of AccessDenied / UnauthorizedOperation errors, the shape of a stolen credential being tried."
    }
  }
}

resource "aws_cloudwatch_log_metric_filter" "trail" {
  for_each = local.trail_alarms

  name           = "${var.name_prefix}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.trail.name
  pattern        = each.value.pattern

  metric_transformation {
    name          = each.key
    namespace     = "${var.name_prefix}/security"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "trail" {
  for_each = local.trail_alarms

  alarm_name          = "${var.name_prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = "${var.name_prefix}/security"
  metric_name         = each.key
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.tags

  depends_on = [aws_cloudwatch_log_metric_filter.trail]
}

# ── GuardDuty ────────────────────────────────────────────────────────────────
# Foundational sources only (CloudTrail management events, VPC flow, DNS).
# The paid plans are declared off so a console default cannot switch them on.

resource "aws_guardduty_detector" "main" {
  count = var.enable_guardduty ? 1 : 0

  enable                       = true
  finding_publishing_frequency = "SIX_HOURS"
  tags                         = var.tags
}

resource "aws_guardduty_detector_feature" "optional_plans" {
  for_each = var.enable_guardduty ? toset([
    "S3_DATA_EVENTS",
    "EKS_AUDIT_LOGS",
    "EBS_MALWARE_PROTECTION",
    "RDS_LOGIN_EVENTS",
    "LAMBDA_NETWORK_LOGS",
  ]) : toset([])

  detector_id = aws_guardduty_detector.main[0].id
  name        = each.key
  status      = "DISABLED"
}

# Runtime Monitoring carries three agent-management sub-features that the
# API reports back even when the plan is off. Left undeclared, every plan
# reads them as a change that forces replacement; declared off, the plan is
# clean.
resource "aws_guardduty_detector_feature" "runtime_monitoring" {
  count = var.enable_guardduty ? 1 : 0

  detector_id = aws_guardduty_detector.main[0].id
  name        = "RUNTIME_MONITORING"
  status      = "DISABLED"

  dynamic "additional_configuration" {
    for_each = ["EKS_ADDON_MANAGEMENT", "ECS_FARGATE_AGENT_MANAGEMENT", "EC2_AGENT_MANAGEMENT"]
    content {
      name   = additional_configuration.value
      status = "DISABLED"
    }
  }
}

resource "aws_cloudwatch_event_rule" "guardduty_high" {
  count = var.enable_guardduty ? 1 : 0

  name        = "${var.name_prefix}-guardduty-high"
  description = "GuardDuty findings with severity 7 or above."
  tags        = var.tags

  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail        = { severity = [{ numeric = [">=", 7] }] }
  })
}

resource "aws_cloudwatch_event_target" "guardduty_high" {
  count = var.enable_guardduty ? 1 : 0

  rule = aws_cloudwatch_event_rule.guardduty_high[0].name
  arn  = aws_sns_topic.alerts.arn
}

# ── Access Analyzer, account settings ────────────────────────────────────────

resource "aws_accessanalyzer_analyzer" "account" {
  analyzer_name = "${var.name_prefix}-account"
  type          = "ACCOUNT"
  tags          = var.tags
}

resource "aws_iam_account_password_policy" "main" {
  minimum_password_length        = 14
  require_lowercase_characters   = true
  require_uppercase_characters   = true
  require_numbers                = true
  require_symbols                = true
  allow_users_to_change_password = true
  max_password_age               = 90
  password_reuse_prevention      = 24
  hard_expiry                    = false
}

resource "aws_ebs_encryption_by_default" "main" {
  enabled = true
}

# ── RequireMFA for operators ─────────────────────────────────────────────────
# The AWS reference policy: without MFA a user can only set MFA up, change
# their password, and mint an MFA session token. Everything else is denied,
# so a leaked long-lived key is inert on its own. Attached only to the users
# listed in mfa_required_users, and only after they have a device.

data "aws_iam_policy_document" "require_mfa" {
  statement {
    sid = "AllowViewAccountInfo"
    actions = [
      "iam:GetAccountPasswordPolicy",
      "iam:GetAccountSummary",
      "iam:ListVirtualMFADevices",
    ]
    resources = ["*"]
  }

  statement {
    sid = "AllowManageOwnPasswordsAndMFA"
    actions = [
      "iam:ChangePassword",
      "iam:GetUser",
      "iam:CreateVirtualMFADevice",
      "iam:DeleteVirtualMFADevice",
      "iam:EnableMFADevice",
      "iam:ListMFADevices",
      "iam:ResyncMFADevice",
    ]
    resources = [
      "arn:${local.partition}:iam::${local.account_id}:user/$${aws:username}",
      "arn:${local.partition}:iam::${local.account_id}:mfa/*",
    ]
  }

  statement {
    sid    = "DenyAllExceptListedIfNoMFA"
    effect = "Deny"
    not_actions = [
      "iam:CreateVirtualMFADevice",
      "iam:EnableMFADevice",
      "iam:GetUser",
      "iam:GetMFADevice",
      "iam:ListMFADevices",
      "iam:ListVirtualMFADevices",
      "iam:ResyncMFADevice",
      "iam:ChangePassword",
      "iam:GetAccountPasswordPolicy",
      "sts:GetSessionToken",
    ]
    resources = ["*"]
    condition {
      test     = "BoolIfExists"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["false"]
    }
  }
}

resource "aws_iam_policy" "require_mfa" {
  name        = "${var.name_prefix}-require-mfa"
  description = "Denies everything except MFA setup, password change and session-token minting when the request carries no MFA."
  policy      = data.aws_iam_policy_document.require_mfa.json
  tags        = var.tags
}

resource "aws_iam_user_policy_attachment" "require_mfa" {
  for_each = toset(var.mfa_required_users)

  user       = each.key
  policy_arn = aws_iam_policy.require_mfa.arn
}

# ── Alerts ───────────────────────────────────────────────────────────────────
# One topic. Email delivery needs the subscription to be confirmed once from
# the inbox; until then the topic exists and nothing arrives.

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-security-alerts"
  tags = var.tags
}

data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid       = "AllowEventBridgePublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "AllowCloudWatchAlarms"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alert_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ══ Stage 3: AWS Config, remediation, Security Hub (enable_config) ═══════════

resource "aws_iam_service_linked_role" "config" {
  count            = local.config_on ? 1 : 0
  aws_service_name = "config.amazonaws.com"
}

resource "aws_config_configuration_recorder" "main" {
  count = local.config_on ? 1 : 0

  name     = "${var.name_prefix}-recorder"
  role_arn = aws_iam_service_linked_role.config[0].arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }
}

resource "aws_config_delivery_channel" "main" {
  count = local.config_on ? 1 : 0

  name           = "${var.name_prefix}-delivery"
  s3_bucket_name = aws_s3_bucket.audit.id
  s3_key_prefix  = "config"

  depends_on = [aws_config_configuration_recorder.main, aws_s3_bucket_policy.audit]
}

resource "aws_config_configuration_recorder_status" "main" {
  count = local.config_on ? 1 : 0

  name       = aws_config_configuration_recorder.main[0].name
  is_enabled = true

  depends_on = [aws_config_delivery_channel.main]
}

locals {
  managed_rules = {
    cloudtrail-enabled = {
      id     = "CLOUD_TRAIL_ENABLED"
      params = tomap({})
    }
    root-account-mfa-enabled = {
      id     = "ROOT_ACCOUNT_MFA_ENABLED"
      params = tomap({})
    }
    iam-user-mfa-enabled = {
      id     = "IAM_USER_MFA_ENABLED"
      params = tomap({})
    }
    access-keys-rotated = {
      id     = "ACCESS_KEYS_ROTATED"
      params = tomap({ maxAccessKeyAge = tostring(var.access_key_max_age_days) })
    }
    iam-user-unused-credentials-check = {
      id     = "IAM_USER_UNUSED_CREDENTIALS_CHECK"
      params = tomap({ maxCredentialUsageAge = tostring(var.unused_credentials_days) })
    }
    iam-password-policy = {
      id = "IAM_PASSWORD_POLICY"
      params = tomap({
        RequireUppercaseCharacters = "true"
        RequireLowercaseCharacters = "true"
        RequireSymbols             = "true"
        RequireNumbers             = "true"
        MinimumPasswordLength      = "14"
        PasswordReusePrevention    = "24"
        MaxPasswordAge             = "90"
      })
    }
    restricted-ssh = {
      id     = "INCOMING_SSH_DISABLED"
      params = tomap({})
    }
    vpc-default-security-group-closed = {
      id     = "VPC_DEFAULT_SECURITY_GROUP_CLOSED"
      params = tomap({})
    }
    s3-bucket-public-read-prohibited = {
      id     = "S3_BUCKET_PUBLIC_READ_PROHIBITED"
      params = tomap({})
    }
    s3-bucket-server-side-encryption-enabled = {
      id     = "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
      params = tomap({})
    }
    encrypted-volumes = {
      id     = "ENCRYPTED_VOLUMES"
      params = tomap({})
    }
    ec2-imdsv2-check = {
      id     = "EC2_IMDSV2_CHECK"
      params = tomap({})
    }
    ecr-private-image-scanning-enabled = {
      id     = "ECR_PRIVATE_IMAGE_SCANNING_ENABLED"
      params = tomap({})
    }
  }
}

resource "aws_config_config_rule" "managed" {
  for_each = local.config_on ? local.managed_rules : {}

  name             = each.key
  input_parameters = length(each.value.params) > 0 ? jsonencode(each.value.params) : null
  tags             = var.tags

  source {
    owner             = "AWS"
    source_identifier = each.value.id
  }

  depends_on = [aws_config_configuration_recorder_status.main]
}

resource "aws_iam_role" "remediation" {
  count = local.config_on ? 1 : 0

  name = "${var.name_prefix}-config-remediation"
  tags = var.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ssm.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "remediation" {
  count = local.config_on ? 1 : 0

  name = "remediation"
  role = aws_iam_role.remediation[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RevokeOpenSsh"
        Effect   = "Allow"
        Action   = ["ec2:DescribeSecurityGroups", "ec2:RevokeSecurityGroupIngress"]
        Resource = "*"
      },
      {
        Sid    = "BlockPublicBuckets"
        Effect = "Allow"
        Action = [
          "s3:GetBucketAcl",
          "s3:PutBucketAcl",
          "s3:GetBucketPolicyStatus",
          "s3:GetBucketPublicAccessBlock",
          "s3:PutBucketPublicAccessBlock",
        ]
        Resource = "arn:${local.partition}:s3:::*"
      },
      {
        Sid      = "DeactivateStaleKeys"
        Effect   = "Allow"
        Action   = ["iam:ListUsers", "iam:ListAccessKeys", "iam:UpdateAccessKey"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_config_remediation_configuration" "open_ssh" {
  count = local.config_on ? 1 : 0

  config_rule_name = aws_config_config_rule.managed["restricted-ssh"].name
  resource_type    = "AWS::EC2::SecurityGroup"
  target_type      = "SSM_DOCUMENT"
  target_id        = "AWS-DisablePublicAccessForSecurityGroup"
  target_version   = "1"

  automatic                  = var.auto_remediate_open_ssh
  maximum_automatic_attempts = 3
  retry_attempt_seconds      = 60

  parameter {
    name         = "AutomationAssumeRole"
    static_value = aws_iam_role.remediation[0].arn
  }
  parameter {
    name           = "GroupId"
    resource_value = "RESOURCE_ID"
  }
}

resource "aws_config_remediation_configuration" "public_s3" {
  count = local.config_on ? 1 : 0

  config_rule_name = aws_config_config_rule.managed["s3-bucket-public-read-prohibited"].name
  resource_type    = "AWS::S3::Bucket"
  target_type      = "SSM_DOCUMENT"
  target_id        = "AWS-DisableS3BucketPublicReadWrite"
  target_version   = "1"

  automatic                  = var.auto_remediate_public_s3
  maximum_automatic_attempts = 3
  retry_attempt_seconds      = 60

  parameter {
    name         = "AutomationAssumeRole"
    static_value = aws_iam_role.remediation[0].arn
  }
  parameter {
    name           = "S3BucketName"
    resource_value = "RESOURCE_ID"
  }
}

# AWS ships no document that deactivates a key by age, so this one is ours.
# Config reports the IAM user's unique id, not its name; the script resolves it.
resource "aws_ssm_document" "deactivate_stale_keys" {
  count = local.config_on ? 1 : 0

  name            = "${var.name_prefix}-DeactivateStaleAccessKeys"
  document_type   = "Automation"
  document_format = "YAML"
  tags            = var.tags

  content = <<-DOC
    schemaVersion: '0.3'
    description: Deactivate active IAM access keys older than MaxAgeDays for the user with the given unique id. Keys are deactivated, never deleted.
    assumeRole: '{{ AutomationAssumeRole }}'
    parameters:
      UserId:
        type: String
        description: IAM user unique id, as reported by AWS Config as the resource id.
      MaxAgeDays:
        type: String
        default: '90'
      AutomationAssumeRole:
        type: String
    mainSteps:
      - name: deactivate
        action: aws:executeScript
        inputs:
          Runtime: python3.10
          Handler: handler
          InputPayload:
            UserId: '{{ UserId }}'
            MaxAgeDays: '{{ MaxAgeDays }}'
          Script: |-
            import datetime
            import boto3

            def handler(events, context):
                iam = boto3.client('iam')
                user = None
                for page in iam.get_paginator('list_users').paginate():
                    for u in page['Users']:
                        if u['UserId'] == events['UserId']:
                            user = u
                if user is None:
                    return {'Deactivated': [], 'Reason': 'user not found'}
                now = datetime.datetime.now(datetime.timezone.utc)
                limit = int(events['MaxAgeDays'])
                deactivated = []
                for key in iam.list_access_keys(UserName=user['UserName'])['AccessKeyMetadata']:
                    if key['Status'] == 'Active' and (now - key['CreateDate']).days > limit:
                        iam.update_access_key(UserName=user['UserName'], AccessKeyId=key['AccessKeyId'], Status='Inactive')
                        deactivated.append(key['AccessKeyId'])
                return {'Deactivated': deactivated, 'Reason': 'ok'}
        outputs:
          - Name: Deactivated
            Selector: $.Payload.Deactivated
            Type: StringList
  DOC
}

resource "aws_config_remediation_configuration" "stale_keys" {
  count = local.config_on ? 1 : 0

  config_rule_name = aws_config_config_rule.managed["access-keys-rotated"].name
  resource_type    = "AWS::IAM::User"
  target_type      = "SSM_DOCUMENT"
  target_id        = aws_ssm_document.deactivate_stale_keys[0].name

  automatic                  = var.auto_deactivate_stale_keys
  maximum_automatic_attempts = 1
  retry_attempt_seconds      = 300

  parameter {
    name         = "AutomationAssumeRole"
    static_value = aws_iam_role.remediation[0].arn
  }
  parameter {
    name           = "UserId"
    resource_value = "RESOURCE_ID"
  }
  parameter {
    name         = "MaxAgeDays"
    static_value = tostring(var.access_key_max_age_days)
  }
}

resource "aws_securityhub_account" "main" {
  count = local.hub_on ? 1 : 0

  enable_default_standards  = false
  control_finding_generator = "SECURITY_CONTROL"
  auto_enable_controls      = true

  depends_on = [aws_config_configuration_recorder_status.main]
}

resource "aws_securityhub_standards_subscription" "fsbp" {
  count = local.hub_on ? 1 : 0

  standards_arn = "arn:${local.partition}:securityhub:${local.region}::standards/aws-foundational-security-best-practices/v/1.0.0"

  depends_on = [aws_securityhub_account.main]
}

resource "aws_cloudwatch_event_rule" "securityhub_failed" {
  count = local.hub_on ? 1 : 0

  name        = "${var.name_prefix}-securityhub-failed"
  description = "New Security Hub findings that failed a HIGH or CRITICAL control."
  tags        = var.tags

  event_pattern = jsonencode({
    source        = ["aws.securityhub"]
    "detail-type" = ["Security Hub Findings - Imported"]
    detail = {
      findings = {
        Compliance  = { Status = ["FAILED"] }
        Severity    = { Label = ["HIGH", "CRITICAL"] }
        RecordState = ["ACTIVE"]
        Workflow    = { Status = ["NEW"] }
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "securityhub_failed" {
  count = local.hub_on ? 1 : 0

  rule = aws_cloudwatch_event_rule.securityhub_failed[0].name
  arn  = aws_sns_topic.alerts.arn
}

resource "aws_cloudwatch_event_rule" "config_noncompliant" {
  count = local.config_on ? 1 : 0

  name        = "${var.name_prefix}-config-noncompliant"
  description = "A Config rule evaluation that changed to NON_COMPLIANT."
  tags        = var.tags

  event_pattern = jsonencode({
    source        = ["aws.config"]
    "detail-type" = ["Config Rules Compliance Change"]
    detail = {
      messageType         = ["ComplianceChangeNotification"]
      newEvaluationResult = { complianceType = ["NON_COMPLIANT"] }
    }
  })
}

resource "aws_cloudwatch_event_target" "config_noncompliant" {
  count = local.config_on ? 1 : 0

  rule = aws_cloudwatch_event_rule.config_noncompliant[0].name
  arn  = aws_sns_topic.alerts.arn
}
