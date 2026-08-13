# The public entry point. HTTP and HTTPS are open to the world; 22 is limited to
# an explicit list.
#
# ingress is under ignore_changes because two automations edit this group at
# runtime — deploy.yml opens the CI runner's address for the duration of a
# deploy, and scripts/ssh-connect.sh rewrites it on every operator connection.
# Without this, each of those leaves the group permanently out of sync with the
# code and any apply would revoke a rule someone is actively using.
#
# This is a concession, not a design. It means the firewall is only partly
# declarative, and the rule list here is a floor rather than the whole truth:
# measured 2026-08-13, the live group carried four SSH CIDRs against the one in
# state, because revocation is best-effort and failures leave entries behind.
# The bastion design retires this by giving the group a single fixed source.
resource "aws_security_group" "this" {
  name_prefix = var.name_prefix
  description = "Security group for insighta"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = length(var.ssh_cidrs) > 0 ? [1] : []
    content {
      description = "SSH - admin (home)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_cidrs
    }
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [ingress]
  }
}
