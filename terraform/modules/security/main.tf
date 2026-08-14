# The public entry point. HTTP and HTTPS are open to the world; 22 is limited to
# an explicit list.
#
# ingress is under ignore_changes because two automations edit this group at
# runtime, and they are distinguishable by what they write:
#
#   deploy.yml          tags the rule Purpose=github-actions-deploy, no Description
#   scripts/ssh-connect.sh  writes Description "JK dynamic SSH <date>"
#
# Without this, each of those leaves the group out of sync with the code and an
# apply would revoke a rule someone is actively using.
#
# This is a concession, not a design. The rule list here is a floor rather than
# the whole truth: on 2026-08-13 the live group carried four port-22 CIDRs
# against the one in state. CloudTrail shows the CI pairs its Authorize with a
# Revoke, so those four were not failed cleanups — they came from ssh-connect.sh,
# which only reaches its cleanup loop on the public-IP path. When Tailscale
# succeeds the script exits before ensure_sg_rule is ever called, so nothing is
# collected, and entries survive until some later run happens to fall through.
#
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
