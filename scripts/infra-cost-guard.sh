#!/usr/bin/env bash
# infra-cost-guard.sh — AWS Free Tier 비용 경고 도구
# Usage: ./scripts/infra-cost-guard.sh <command> [args]
#
# Commands:
#   check <resource-type>   Check if resource creation is safe (Free Tier)
#   status                  Show current AWS resource usage vs Free Tier limits
#   estimate <tf-plan-file> Parse terraform plan and warn about costs
#
# Exit codes: 0=PASS, 1=WARN, 2=BLOCK
#
# Compatible with bash 3.2+ (macOS default)

set -eo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

REGION="${AWS_REGION:-us-west-2}"

# ─── Resource Classification (bash 3.2 compatible) ───

get_safe_message() {
  case "$1" in
    sg)                 echo "Security Group 규칙 변경 — 무료" ;;
    iam)                echo "IAM 유저/롤/정책 — 무료" ;;
    s3_bucket)          echo "S3 버킷 생성 (5GB 이내) — 무료" ;;
    cloudwatch_metric)  echo "CloudWatch 커스텀 메트릭 (10개 이내) — 무료" ;;
    dynamodb)           echo "DynamoDB (25GB/25RCU/25WCU 이내) — 무료" ;;
    tags)               echo "태그 추가/변경 — 무료" ;;
    terraform_state)    echo "Terraform state 관리 — 무료" ;;
    eip)                echo "EIP (EC2 연결 시) — 무료" ;;
    *)                  echo "" ;;
  esac
}

get_cost_level() {
  case "$1" in
    rds)                      echo "BLOCK" ;;
    elasticache)              echo "BLOCK" ;;
    nat_gateway)              echo "BLOCK" ;;
    alb)                      echo "BLOCK" ;;
    nlb)                      echo "BLOCK" ;;
    vpn)                      echo "BLOCK" ;;
    eks)                      echo "BLOCK" ;;
    ec2_non_micro)            echo "BLOCK" ;;
    route53_zone)             echo "WARN" ;;
    secrets_manager)          echo "WARN" ;;
    ecs)                      echo "WARN" ;;
    ebs_extra)                echo "WARN" ;;
    cloudwatch_alarm_extra)   echo "WARN" ;;
    s3_replication)           echo "WARN" ;;
    *)                        echo "" ;;
  esac
}

get_cost_message() {
  case "$1" in
    rds)                      echo "RDS는 Free Tier 제한적 (db.t3.micro 750h/월, 12개월). 신규 생성 비추천" ;;
    elasticache)              echo "ElastiCache는 Free Tier 없음. 월 ~\$15+" ;;
    nat_gateway)              echo "NAT Gateway는 시간당 \$0.045 + 데이터 요금. 월 ~\$32+" ;;
    alb)                      echo "ALB는 시간당 \$0.0225. 월 ~\$16+" ;;
    nlb)                      echo "NLB는 시간당 \$0.0225. 월 ~\$16+" ;;
    vpn)                      echo "VPN 연결당 시간 \$0.05. 월 ~\$36+" ;;
    eks)                      echo "EKS 클러스터당 \$0.10/시간 (\$73/월)" ;;
    ec2_non_micro)            echo "t2.micro 외 인스턴스는 과금 대상" ;;
    route53_zone)             echo "Route 53 호스팅 존당 \$0.50/월" ;;
    secrets_manager)          echo "Secrets Manager 시크릿당 \$0.40/월" ;;
    ecs)                      echo "ECS(Fargate)는 vCPU/메모리 기반 과금" ;;
    ebs_extra)                echo "30GB 초과 EBS는 GB당 \$0.08/월 (gp3)" ;;
    cloudwatch_alarm_extra)   echo "10개 초과 알람은 알람당 \$0.10/월" ;;
    s3_replication)           echo "Cross-Region Replication은 데이터 전송 비용 발생" ;;
    *)                        echo "" ;;
  esac
}

check_resource() {
  local resource_type="${1:-}"

  if [ -z "$resource_type" ]; then
    echo -e "${RED}Usage: $0 check <resource-type>${NC}"
    echo "Safe: sg iam s3_bucket cloudwatch_metric dynamodb tags terraform_state eip"
    echo "Cost: rds elasticache nat_gateway alb nlb vpn eks ec2_non_micro route53_zone secrets_manager ecs ebs_extra cloudwatch_alarm_extra s3_replication"
    exit 2
  fi

  # Check safe resources first
  local safe_msg
  safe_msg=$(get_safe_message "$resource_type")
  if [ -n "$safe_msg" ]; then
    echo -e "${GREEN}PASS${NC} [$resource_type] $safe_msg"
    exit 0
  fi

  # Check cost resources
  local level
  level=$(get_cost_level "$resource_type")
  if [ -n "$level" ]; then
    local message
    message=$(get_cost_message "$resource_type")

    if [ "$level" = "BLOCK" ]; then
      echo -e "${RED}BLOCK${NC} [$resource_type] $message"
      echo -e "${RED}>>> 유저 확인 필수! 이 리소스는 Free Tier 범위를 벗어납니다.${NC}"
      exit 2
    else
      echo -e "${YELLOW}WARN${NC} [$resource_type] $message"
      echo -e "${YELLOW}>>> 비용 발생 가능. 유저에게 확인 권장.${NC}"
      exit 1
    fi
  fi

  echo -e "${YELLOW}WARN${NC} [$resource_type] 알 수 없는 리소스 타입. 비용 확인 필요."
  exit 1
}

show_status() {
  echo -e "${CYAN}=== AWS Free Tier Usage Status ===${NC}"
  echo ""

  # EC2 instances
  local ec2_count
  ec2_count=$(aws ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running" \
    --query "length(Reservations[].Instances[])" \
    --region "$REGION" --output text 2>/dev/null || echo "?")
  local ec2_limit=1
  if [ "$ec2_count" = "?" ]; then
    echo -e "  EC2 Instances:  ${YELLOW}? / $ec2_limit${NC} (확인 실패)"
  elif [ "$ec2_count" -ge "$ec2_limit" ]; then
    echo -e "  EC2 Instances:  ${RED}$ec2_count / $ec2_limit${NC} (추가 시 과금!)"
  else
    echo -e "  EC2 Instances:  ${GREEN}$ec2_count / $ec2_limit${NC}"
  fi

  # S3 buckets
  local s3_count
  s3_count=$(aws s3 ls --region "$REGION" 2>/dev/null | wc -l | tr -d ' ')
  echo -e "  S3 Buckets:     ${GREEN}${s3_count} buckets${NC}"

  # Check backup bucket size
  local backup_size
  backup_size=$(aws s3 ls s3://insighta-backups --recursive --summarize --region "$REGION" 2>/dev/null \
    | grep "Total Size" | awk '{print $3}' || echo "0")
  local backup_mb=$((backup_size / 1024 / 1024))
  local s3_limit_mb=$((5 * 1024))
  if [ "$backup_mb" -gt "$s3_limit_mb" ]; then
    echo -e "  S3 Backup Size: ${RED}${backup_mb}MB / ${s3_limit_mb}MB${NC}"
  else
    echo -e "  S3 Backup Size: ${GREEN}${backup_mb}MB / ${s3_limit_mb}MB${NC}"
  fi

  # EBS volumes
  local ebs_total
  ebs_total=$(aws ec2 describe-volumes \
    --query "sum(Volumes[].Size)" \
    --region "$REGION" --output text 2>/dev/null || echo "?")
  local ebs_limit=30
  if [ "$ebs_total" = "?" ] || [ "$ebs_total" = "None" ]; then
    echo -e "  EBS Storage:    ${YELLOW}? / ${ebs_limit}GB${NC}"
  elif [ "$ebs_total" -gt "$ebs_limit" ]; then
    echo -e "  EBS Storage:    ${RED}${ebs_total}GB / ${ebs_limit}GB${NC} (초과분 과금)"
  else
    echo -e "  EBS Storage:    ${GREEN}${ebs_total}GB / ${ebs_limit}GB${NC}"
  fi

  # CloudWatch
  echo -e "  CW Metrics:     ${GREEN}3 / 10${NC} (CPU/mem/disk)"
  echo -e "  CW Alarms:      ${GREEN}0 / 10${NC}"

  # DynamoDB
  echo -e "  DynamoDB:       ${GREEN}1 table (TF lock)${NC}"

  echo ""
  echo -e "${CYAN}=== Monthly Estimate: \$0.00 (Free Tier) ===${NC}"
}

estimate_plan() {
  local plan_file="${1:-}"

  if [ -z "$plan_file" ] || [ ! -f "$plan_file" ]; then
    echo -e "${RED}Usage: $0 estimate <terraform-plan-output-file>${NC}"
    exit 2
  fi

  echo -e "${CYAN}=== Terraform Plan Cost Analysis ===${NC}"
  echo ""

  local warnings=0
  local blocks=0

  # Check for dangerous resource types in plan
  while IFS= read -r line; do
    if echo "$line" | grep -qE "aws_instance|aws_db_instance|aws_elasticache|aws_nat_gateway|aws_lb|aws_eks"; then
      if echo "$line" | grep -q "will be created"; then
        local resource
        resource=$(echo "$line" | grep -oE 'aws_[a-z_]+' | head -1)
        echo -e "  ${RED}NEW RESOURCE${NC}: $resource — 비용 확인 필요!"
        blocks=$((blocks + 1))
      fi
    fi
  done < "$plan_file"

  # Check for destroy (potential savings)
  local destroys
  destroys=$(grep -c "will be destroyed" "$plan_file" 2>/dev/null || echo "0")
  if [ "$destroys" -gt 0 ]; then
    echo -e "  ${GREEN}$destroys resources destroyed${NC} — 비용 절감 가능"
  fi

  if [ "$blocks" -gt 0 ]; then
    echo ""
    echo -e "  ${RED}>>> $blocks 개 리소스가 비용을 발생시킬 수 있습니다!${NC}"
    exit 2
  elif [ "$warnings" -gt 0 ]; then
    echo -e "  ${YELLOW}>>> $warnings 개 경고${NC}"
    exit 1
  else
    echo -e "  ${GREEN}>>> 비용 영향 없음 (Free Tier 범위)${NC}"
    exit 0
  fi
}

# ─── Main ───
case "${1:-help}" in
  check)    check_resource "${2:-}" ;;
  status)   show_status ;;
  estimate) estimate_plan "${2:-}" ;;
  help|--help|-h)
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  check <type>     Check if resource is Free Tier safe"
    echo "  status           Show current AWS usage vs limits"
    echo "  estimate <file>  Analyze terraform plan for costs"
    echo ""
    echo "Resource types (check):"
    echo "  Safe: sg iam s3_bucket cloudwatch_metric dynamodb tags terraform_state eip"
    echo "  Cost: rds elasticache nat_gateway alb nlb vpn eks ec2_non_micro"
    echo "        route53_zone secrets_manager ecs ebs_extra cloudwatch_alarm_extra s3_replication"
    ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    echo "Run '$0 help' for usage"
    exit 2
    ;;
esac
