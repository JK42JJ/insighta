output "instance_id" {
  value = module.compute.instance_id
}

output "public_ip" {
  value = module.compute.instance_public_ip
}

output "security_group_id" {
  value = module.security.sg_id
}
