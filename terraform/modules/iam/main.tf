# IAM Module - Instance profile and CI/CD policies

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# EC2 Instance Role
resource "aws_iam_role" "ec2" {
  name = "${var.role_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    ManagedBy = "terraform"
  }
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.role_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# SSM access (optional - for SSH-less management)
resource "aws_iam_role_policy_attachment" "ssm" {
  count      = var.enable_ssm ? 1 : 0
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# CloudWatch access (optional - for monitoring)
resource "aws_iam_role_policy_attachment" "cloudwatch" {
  count      = var.enable_cloudwatch ? 1 : 0
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}
