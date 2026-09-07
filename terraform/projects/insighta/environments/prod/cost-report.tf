# Billing data, delivered rather than queried.
#
# The Cost Explorer API answers the same questions and charges $0.01 per
# request. Polling it hourly is $7/month to find out whether we are spending
# money, which is a poor trade. A Cost and Usage Report is pushed to S3 on a
# schedule at no charge; the only cost is storing a few megabytes.
#
# Measured 2026-09-07: `AWS Cost Explorer  0.09` already appears as a line item
# on this account, which is what prompted the switch.
#
# The report is read by scripts/monitor/check-aws-cost.ts, which pulls the most
# recent object from this bucket. Nothing queries a billing API at runtime.

# CUR report definitions live only at the us-east-1 endpoint, whichever region
# the bucket is in. This alias exists for that one resource.
provider "aws" {
  alias  = "billing"
  region = "us-east-1"
}

resource "aws_s3_bucket" "cost_reports" {
  bucket = var.cost_report_bucket_name
  tags   = merge(local.common_tags, { Name = var.cost_report_bucket_name })
}

resource "aws_s3_bucket_public_access_block" "cost_reports" {
  bucket                  = aws_s3_bucket.cost_reports.id
  block_public_acls       = true
  block_public_policy     = false # the delivery policy below is not public
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cost_reports" {
  bucket = aws_s3_bucket.cost_reports.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Reports are cumulative for the month and re-delivered as they are revised, so
# yesterday's copies stop being interesting quickly. Ninety days is enough to
# answer "what changed last quarter" and keeps the bucket at a few megabytes.
resource "aws_s3_bucket_lifecycle_configuration" "cost_reports" {
  bucket = aws_s3_bucket.cost_reports.id
  rule {
    id     = "expire-old-reports"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}

data "aws_caller_identity" "current" {}

# The billing service writes here. Scoped by SourceAccount and SourceArn so the
# grant cannot be used by another account's report definition.
data "aws_iam_policy_document" "cost_reports" {
  statement {
    sid    = "AllowBillingReportsRead"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["billingreports.amazonaws.com"]
    }
    actions   = ["s3:GetBucketAcl", "s3:GetBucketPolicy"]
    resources = [aws_s3_bucket.cost_reports.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cur:us-east-1:${data.aws_caller_identity.current.account_id}:definition/*"]
    }
  }

  statement {
    sid    = "AllowBillingReportsWrite"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["billingreports.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cost_reports.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cur:us-east-1:${data.aws_caller_identity.current.account_id}:definition/*"]
    }
  }
}

resource "aws_s3_bucket_policy" "cost_reports" {
  bucket = aws_s3_bucket.cost_reports.id
  policy = data.aws_iam_policy_document.cost_reports.json

  # The public access block and the policy race on creation; ordering them
  # avoids an apply that fails on the first run and succeeds on the second.
  depends_on = [aws_s3_bucket_public_access_block.cost_reports]
}

resource "aws_cur_report_definition" "daily" {
  provider = aws.billing

  report_name = "insighta-daily-cost"
  time_unit   = "DAILY"
  format      = "textORcsv"
  compression = "GZIP"

  # Empty on purpose. The only other option that applies here is RESOURCES,
  # which names every individual instance and object and multiplies the file
  # size for detail this account does not need: with one node and four
  # services, the per-service breakdown is already the answer.
  additional_schema_elements = []

  s3_bucket = aws_s3_bucket.cost_reports.id
  s3_prefix = "cur"
  s3_region = var.aws_region

  additional_artifacts = []

  # Revised charges land in a fresh copy of the month rather than being lost,
  # and OVERWRITE_REPORT keeps exactly one copy per month instead of one per
  # delivery. CREATE_NEW_REPORT would accumulate a file per refresh.
  refresh_closed_reports = true
  report_versioning      = "OVERWRITE_REPORT"

  depends_on = [aws_s3_bucket_policy.cost_reports]
}
