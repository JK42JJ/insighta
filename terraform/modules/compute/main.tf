# Compute Module - EC2 instance with EIP and cloud-init

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_instance" "this" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = var.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids

  iam_instance_profile = var.iam_instance_profile

  user_data = var.user_data_vars != null ? templatefile(
    "${path.module}/cloud-init.tpl",
    var.user_data_vars
  ) : null

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  tags = merge(var.tags, {
    Name      = var.instance_name
    ManagedBy = "terraform"
  })

  lifecycle {
    ignore_changes = [user_data, ami, subnet_id, security_groups, root_block_device]
  }
}

resource "aws_eip" "this" {
  count  = var.create_eip ? 1 : 0
  domain = "vpc"

  tags = merge(var.tags, {
    Name      = "${var.instance_name}-eip"
    ManagedBy = "terraform"
  })
}

resource "aws_eip_association" "this" {
  count         = var.create_eip ? 1 : 0
  instance_id   = aws_instance.this.id
  allocation_id = aws_eip.this[0].id
}
