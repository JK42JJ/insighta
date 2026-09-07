# The identity GitHub Actions uses to run Terraform. Reconstructed from state
# for the same reason as the prod stack: the .tf files were gone and only the
# backend knew what existed.
resource "aws_iam_user" "ci" {
  name = "github-actions-terraform"
  path = "/"

  tags = {
    ManagedBy = "terraform"
    Purpose   = "GitHub Actions CI/CD"
  }
}

# A managed policy rather than an inline one, since 2026-09-07.
#
# Inline policies are capped at 2048 bytes *in total per user*, so splitting
# one in two does not buy room. Adding the cost-report grants took this
# document past the cap and the apply failed with LimitExceeded. A managed
# policy allows 6144, which is the actual fix rather than trimming statements
# that were written deliberately.
resource "aws_iam_policy" "ci" {
  name        = "terraform-ci-policy"
  description = "Permissions for the GitHub Actions Terraform identity."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformStateAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::insighta-terraform-state",
          "arn:aws:s3:::insighta-terraform-state/*",
        ]
      },
      {
        Sid    = "TerraformLockAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
        ]
        Resource = "arn:aws:dynamodb:us-west-2:*:table/insighta-terraform-lock"
      },
      {
        Sid    = "EC2Management"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          "ec2:StopInstances",
          "ec2:StartInstances",
          "ec2:AllocateAddress",
          "ec2:ReleaseAddress",
          "ec2:AssociateAddress",
          "ec2:DisassociateAddress",
        ]
        Resource = "*"
      },
      {
        # Reading and writing objects was enough while the bucket was only a
        # backup target. It is not enough to manage the bucket: refreshing
        # aws_s3_bucket and its five configuration resources reads the policy,
        # ACL, versioning, encryption, lifecycle, tagging and the rest, and the
        # plan died on GetBucketPolicy with AccessDenied.
        #
        # It died invisibly, which was the worse half — the plan step piped
        # through tee, so CI reported success over the error. That is fixed in
        # .github/workflows/terraform.yml; this statement is the other half.
        Sid    = "S3BackupAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketPolicy",
          "s3:GetBucketAcl",
          "s3:GetBucketCORS",
          "s3:GetBucketWebsite",
          "s3:GetBucketVersioning",
          "s3:GetAccelerateConfiguration",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketLogging",
          "s3:GetLifecycleConfiguration",
          "s3:GetReplicationConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketTagging",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketOwnershipControls",
        ]
        Resource = [
          "arn:aws:s3:::insighta-backups",
          "arn:aws:s3:::insighta-backups/*",
        ]
      },
      {
        # The cost report bucket, which this identity creates rather than
        # merely writes to. Separate from the backup statement because the
        # verbs are different: backups are written to a bucket somebody else
        # made, and this one is managed end to end.
        #
        # DeleteBucket is deliberately absent. Removing the bucket would take
        # the billing history with it, and needing an administrator for that is
        # the intended amount of friction.
        Sid    = "S3CostReportBucket"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:PutBucketPolicy",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:PutBucketTagging",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketPolicy",
          "s3:GetBucketAcl",
          "s3:GetBucketCORS",
          "s3:GetBucketWebsite",
          "s3:GetBucketVersioning",
          "s3:GetAccelerateConfiguration",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketLogging",
          "s3:GetLifecycleConfiguration",
          "s3:GetReplicationConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketTagging",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketOwnershipControls",
        ]
        Resource = [
          "arn:aws:s3:::insighta-cost-reports",
          "arn:aws:s3:::insighta-cost-reports/*",
        ]
      },
      {
        # Cost and Usage Report definitions. The report is what makes billing
        # readable without the Cost Explorer API, which bills $0.01 per
        # request; this identity manages the definition, and AWS delivers the
        # data to the bucket above at no charge.
        #
        # The API takes no resource ARNs -- it is account-scoped -- so "*" here
        # is the only expressible form rather than a widened scope.
        Sid    = "CostAndUsageReport"
        Effect = "Allow"
        # The three tag verbs are not decoration. The provider reads a
        # resource back after creating it, so a grant that covers only the
        # write verbs creates the report and then fails on ListTagsForResource
        # -- leaving the definition live in AWS and absent from state, which is
        # the worst of the two outcomes. Measured 2026-09-07.
        Action = [
          "cur:DescribeReportDefinitions",
          "cur:PutReportDefinition",
          "cur:ModifyReportDefinition",
          "cur:DeleteReportDefinition",
          "cur:ListTagsForResource",
          "cur:TagResource",
          "cur:UntagResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "IAMReadOnly"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetInstanceProfile",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_user_policy_attachment" "ci" {
  user       = aws_iam_user.ci.name
  policy_arn = aws_iam_policy.ci.arn
}
