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

resource "aws_iam_user_policy" "ci" {
  name = "terraform-ci-policy"
  user = aws_iam_user.ci.name

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
