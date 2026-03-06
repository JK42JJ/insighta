# Infrastructure Change Log

> 모든 인프라 변경 이력. `infra-dev` agent가 작업 시 자동 기록.
> 최신 항목이 상단.

---

### 2026-03-06: CloudWatch Agent 설치 (#4)
- **변경**: EC2에 CloudWatch Agent 설치, IAM 정책 연결
- **이유**: 서버 모니터링 (CPU/메모리/디스크)
- **영향**: EC2 `i-0b375829716559a09`, IAM Role `insighta-ec2-role`
- **비용**: Free Tier (커스텀 메트릭 3/10개)
- **커밋**: `0ac287a`
- **롤백**: `sudo systemctl stop amazon-cloudwatch-agent` + terraform에서 `enable_cloudwatch = false`

### 2026-03-06: SG SSH 제한 (#3)
- **변경**: SSH 0.0.0.0/0 → 119.194.145.146/32, deploy.yml에 동적 SG 추가
- **이유**: 보안 강화 — SSH를 admin IP만 허용
- **영향**: SG `sg-079aa1ca6855e587b`, deploy.yml
- **비용**: 무료
- **커밋**: `0ac287a`
- **롤백**: `main.tf` L31에서 SSH cidr를 `0.0.0.0/0`으로 복원 + terraform apply

### 2026-03-06: Terraform Import + S3 Backup + CI IAM (#5, #35)
- **변경**:
  - State backend 부트스트랩 (S3 `insighta-terraform-state` + DynamoDB `insighta-terraform-lock`)
  - 기존 리소스 Terraform import (EC2, SG, EIP, EIP Assoc)
  - S3 backup 버킷 `insighta-backups` 생성 (lifecycle: 30d→IA, 90d expire)
  - IAM Role `insighta-ec2-role` + Profile 생성 및 EC2 연결
  - CI IAM User `github-actions-terraform` 생성
  - GitHub Secrets `TF_AWS_ACCESS_KEY_ID`, `TF_AWS_SECRET_ACCESS_KEY` 등록
  - backup.yml PG17 클라이언트 수정 + issues:write 권한 추가
- **이유**: 인프라를 코드로 관리 (IaC) + 자동 DB 백업
- **영향**: 전체 AWS 인프라
- **비용**: Free Tier (S3 5GB 이내, DynamoDB 25GB 이내)
- **커밋**: `5c4791e`, `31ce9f1`
- **롤백**: terraform state는 S3에 보관. 개별 리소스 `terraform state rm`으로 관리 해제 가능

### 2026-03-06: SG 교체 (launch-wizard-1 → insighta-sg)
- **변경**: 기존 `launch-wizard-1` SG를 Terraform managed `insighta-sg-*`로 교체
- **이유**: Terraform 관리를 위해 name_prefix/description 통일
- **영향**: SG ID 변경 `sg-0ac51181262b7e855` → `sg-079aa1ca6855e587b`, EC2 in-place 업데이트
- **비용**: 무료
- **커밋**: `5c4791e`
- **롤백**: 불필요 (이미 안정적으로 작동 중)
