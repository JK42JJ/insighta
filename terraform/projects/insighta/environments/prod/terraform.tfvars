aws_region = "us-west-2"
ami_id     = "ami-055c254ebd87b4dba"

# Measured on the running instance 2026-08-13 via IMDS. This file said t2.micro
# and so did the state, while the machine had been t3.medium for some time —
# somebody resized it outside Terraform and nothing compared the two. Planning
# against the old value would have proposed downsizing production.
instance_type = "t3.medium"

key_name         = "prx01-tubearchive"
domain           = "insighta.one"
root_volume_size = 20

# Port 22 sources. This is a floor, not the whole list: deploy.yml and
# scripts/ssh-connect.sh add and remove rules at runtime, so the module ignores
# ingress changes. The live group carried four SSH CIDRs when this was written
# against the one recorded in state, because revocation is best-effort.
ssh_cidrs = ["115.143.184.132/32"]

# Phase 2 features
enable_ssm        = false
enable_cloudwatch = true
