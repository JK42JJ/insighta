# The identity GitHub Actions should use instead of the user above: a role
# assumed with a short-lived token that GitHub mints per job. Nothing to
# store, nothing to rotate, nothing to leak from a runner log.
#
# The trust policy names the repository and the three shapes of job that
# need AWS: pushes to main (deploy, keel, backup, rollback), jobs bound to
# the production environment (terraform apply), and pull requests from this
# repository (terraform plan). A pull request from a fork carries the fork's
# repository in the subject and is refused.
#
# Applied by hand from this directory, like the user was. Once every workflow
# assumes the role and has run green, the user's access key is deleted in a
# separate change.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # AWS validates GitHub's token against its own trust store since 2023 and
  # ignores this list; the argument is still required by the API.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = {
    ManagedBy = "terraform"
    Purpose   = "GitHub Actions OIDC"
  }
}

data "aws_iam_policy_document" "github_actions_trust" {
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
      values = [
        "repo:JK42JJ/insighta:ref:refs/heads/main",
        "repo:JK42JJ/insighta:environment:production",
        "repo:JK42JJ/insighta:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name                 = "insighta-github-actions"
  assume_role_policy   = data.aws_iam_policy_document.github_actions_trust.json
  max_session_duration = 3600

  tags = {
    ManagedBy = "terraform"
    Purpose   = "GitHub Actions CI/CD (OIDC)"
  }
}

# The same three policies the user carries. Two of them were created outside
# Terraform and are looked up by name rather than recreated.
data "aws_iam_policy" "ci_ec2_modify" {
  name = "insighta-ci-ec2-modify"
}

data "aws_iam_policy" "ci_ecr" {
  name = "insighta-ci-ecr"
}

resource "aws_iam_role_policy_attachment" "github_actions" {
  for_each = {
    terraform  = aws_iam_policy.ci.arn
    ec2_modify = data.aws_iam_policy.ci_ec2_modify.arn
    ecr        = data.aws_iam_policy.ci_ecr.arn
  }

  role       = aws_iam_role.github_actions.name
  policy_arn = each.value
}
