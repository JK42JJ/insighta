# Staging images built from agent/* branches (staging_only runs of deploy.yml).
#
# A branch run must not be able to touch the production images, so it gets its own repositories and a role that can push to those two repositories and
# nothing else: no repository creation or deletion, no repository policy, no tag-mutability change, no iam:PassRole, no EC2 or Terraform permission.
# The CI role in oidc.tf is refused for these branches on purpose (its trust names main, the production environment and pull requests).
#
# The role is trusted only for agent/* branches of this repository. The k3s node role already reads every ECR repository (AmazonEC2ContainerRegistryReadOnly),
# so staging can pull from the new repositories without an IAM change.

locals {
  stg_repositories = ["insighta-stg-api", "insighta-stg-frontend"]
}

resource "aws_ecr_repository" "stg" {
  for_each             = toset(local.stg_repositories)
  name                 = each.key
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    ManagedBy = "terraform"
    Purpose   = "Staging images built from agent branches"
  }
}

# Storage is billed: keep the 15 newest images per repository.
resource "aws_ecr_lifecycle_policy" "stg" {
  for_each   = aws_ecr_repository.stg
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 15 newest images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 15
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_iam_policy" "stg_ecr_push" {
  name        = "insighta-stg-ecr-push"
  description = "Push images to the staging repositories only."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuthTokenIsAccountWide"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "PushToStagingRepositoriesOnly"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = [for r in aws_ecr_repository.stg : r.arn]
      },
    ]
  })
}

data "aws_iam_policy_document" "github_actions_stg_build_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:JK42JJ/insighta:ref:refs/heads/agent/*"]
    }
  }
}

resource "aws_iam_role" "github_actions_stg_build" {
  name                 = "insighta-github-actions-stg-build"
  assume_role_policy   = data.aws_iam_policy_document.github_actions_stg_build_trust.json
  max_session_duration = 3600

  tags = {
    ManagedBy = "terraform"
    Purpose   = "GitHub Actions staging image build from agent branches"
  }
}

resource "aws_iam_role_policy_attachment" "github_actions_stg_build" {
  role       = aws_iam_role.github_actions_stg_build.name
  policy_arn = aws_iam_policy.stg_ecr_push.arn
}

output "github_actions_stg_build_role_arn" {
  description = "Role for staging image builds from agent/* branches. Store it as the AWS_STG_BUILD_ROLE_ARN repository secret."
  value       = aws_iam_role.github_actions_stg_build.arn
}
