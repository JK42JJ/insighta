# The single production instance, plus the address the DNS record points at.
#
# instance_type is the value this repository got wrong for months. terraform.tfvars
# and the state both said t2.micro while the running machine was t3.medium —
# somebody resized it outside Terraform and nothing ever compared the two. The
# variable now carries the measured value, and the refresh that reconciles state
# is a prerequisite for any apply: planning against the stale value would have
# proposed downsizing production.
#
# IMDSv2 is required (http_tokens), which is what makes the metadata queries in
# the deploy and backup jobs need a token first.
resource "aws_instance" "this" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = var.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids
  iam_instance_profile   = var.instance_profile

  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = var.root_volume_type
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tags = merge(var.tags, { Name = var.name })

  # The AMI is pinned deliberately; a newer default image would replace the
  # instance and take the Docker volumes with it. user_data is likewise not
  # managed here — the box was configured by hand, which is the gap the Ansible
  # step in the migration plan closes.
  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64]
  }
}

# A stable address so DNS and the SSH allowlist do not move when the instance
# is stopped or replaced.
# The Elastic IP used to live here. It was moved to the root module on
# 2026-08-19: the address outlived this instance at the cutover, and a resource
# whose lifecycle is tied to a host it no longer belongs to plans to delete
# something nobody meant to delete. See aws_eip.service in the prod environment.
