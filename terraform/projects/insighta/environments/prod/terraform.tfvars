aws_region       = "us-west-2"
ami_id           = "ami-055c254ebd87b4dba"
instance_type    = "t2.micro"
key_name         = "prx01-tubearchive"
domain           = "insighta.one"
root_volume_size = 20

# Phase 2 features
enable_ssm        = false
enable_cloudwatch = true
