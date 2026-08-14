# The instance's identity. Only the CloudWatch agent policy is attached today —
# nothing here grants access to application data, which is why the app still
# carries its own credentials in env rather than assuming this role.
resource "aws_iam_role" "ec2" {
  name = "${var.name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  count      = var.enable_cloudwatch ? 1 : 0
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name}-profile"
  role = aws_iam_role.ec2.name
}
