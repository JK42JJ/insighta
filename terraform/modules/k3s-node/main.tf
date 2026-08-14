# The k3s validation node.
#
# Separate from the production instance on purpose. Installing k3s alongside
# the running application would put its iptables rules on the same host that
# terminates TLS and proxies to the production containers, and no snapshot or
# rollback script removes the possibility of interference. A second instance
# removes it outright.
#
# What this buys is isolation, not availability -- one node is still one node.
# Availability arrives at cutover, when a second node is added.
#
# It is also what makes the migration plan's "parallel, traffic 0" real: with
# two machines the cutover is a DNS weight and the rollback is that weight
# going back to zero. On a shared host neither is true.

# The node's own group. Deliberately not the production one, which opens 80 and
# 443 to the world for the public site -- this node serves nothing.
#
# 6443 is absent on purpose. The access-plane design settled on reaching the
# API server through an SSH forward rather than exposing it, so the cluster's
# control port has no inbound rule at all. `kubectl` runs over `ssh -L`.
#
# ingress carries the same ignore_changes concession as the production group:
# port 22 is opened at connect time by scripts/ssh-connect.sh, and without this
# an apply would revoke a rule someone is using.
resource "aws_security_group" "this" {
  name_prefix = "insighta-k3s-"
  description = "k3s validation node -- SSH only, no inbound API"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = length(var.ssh_cidrs) > 0 ? [1] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.ssh_cidrs
    }
  }

  egress {
    description = "All outbound -- image pulls, Supabase, package installs"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "insighta-k3s-sg" })

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [ingress]
  }
}

resource "aws_instance" "this" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = var.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = concat([aws_security_group.this.id], var.security_group_ids)
  iam_instance_profile   = var.iam_instance_profile != "" ? var.iam_instance_profile : null

  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tags = merge(var.tags, {
    Name = var.name
    Role = "k3s-validation"
  })

  # No user_data. k3s is installed by hand for the first node so the install
  # is observed rather than assumed; the repeatable form is an Ansible
  # playbook, which is where it belongs once the arguments are settled.
  #
  # No EIP either. This node serves no traffic and nothing points DNS at it,
  # so a stable address buys nothing yet. It gets one at cutover.
  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64]
  }
}
