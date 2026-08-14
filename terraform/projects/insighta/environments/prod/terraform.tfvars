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

# Empty on purpose. There is no standing operator rule to declare: every port-22
# entry on this group is written at runtime, by deploy.yml for a CI runner or by
# scripts/ssh-connect.sh for whoever is connecting, and the module ignores
# ingress changes so nothing here would be applied anyway.
#
# 115.143.184.132/32 used to sit here, carried over from state where it read as
# "SSH - admin (home)". The live rule's own description said "JK dynamic SSH
# 2026-08-04" — it was one more transient entry, not a fixed address, and it was
# revoked on 2026-08-13 along with two others of the same kind.
ssh_cidrs = []

# Phase 2 features
enable_ssm        = false
enable_cloudwatch = true
