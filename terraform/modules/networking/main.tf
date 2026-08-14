# Phase 1 deliberately runs in the default VPC rather than building one. The
# state records it as vpc-045997ca5f3c756cc / 172.31.0.0/16, and nothing here
# creates network resources — this module only looks up what already exists so
# the other modules have something to attach to.
data "aws_vpc" "default" {
  default = var.vpc_id == "" ? true : null
  id      = var.vpc_id == "" ? null : var.vpc_id
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
