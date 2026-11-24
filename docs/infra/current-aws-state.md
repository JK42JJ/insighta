# AWS 현황 (읽기 전용 조사)

- 조사일: 2026-11-04 (수) 저녁, KST. 인프라 선구매 결정의 입력으로 쓴다.
- 이 문서는 **사실만** 적는다. 어떤 리소스도 만들거나 바꾸거나 지우지 않았다. 구매 · 변경 권고는 11절의 "결정에 영향을 주는 사실"까지만 쓰고 결론은 내리지 않았다.
- 공개 repo 이므로 계정 ID, IP 주소, 인스턴스 ID, ARN 은 쓰지 않았다.
- 표기: **IaC** = terraform · 차트 · 문서가 선언한 값(실제와 다를 수 있음), **라이브** = 이 조사에서 AWS API 로 직접 읽은 값, **문서** = repo 문서의 서술, **추정** = 읽지 않고 추론, **미조회** = 조회하지 못함.

## 0. 조사 방법과 범위

| 구분 | 내용 |
|---|---|
| 라이브 조회 | AWS CLI 읽기 호출만: `describe-*`, `list-*`, `get-*`, CloudWatch `get-metric-statistics`, S3 목록, Cost and Usage Report(CUR) 파일 읽기. 사용한 프로파일은 `default`(IAM 사용자 `admin`) 하나 |
| 비용 데이터 | **Cost Explorer API 를 쓰지 않고 CUR(S3)을 읽었다.** Cost Explorer API 는 요청당 $0.01 이고, 이 프로젝트는 그 때문에 CUR 버킷을 만들어 두었다(`terraform/projects/insighta/environments/prod/cost-report.tf`). 9월 CUR 에 Cost Explorer $0.03 이 찍혀 있어 과거에 호출된 적은 있다 |
| 코드 · IaC | `origin/main` 의 terraform, ansible, 차트, 문서를 읽었다 |
| **조회하지 않은 것** | 클러스터 라이브 상태(kubectl). 이유: 이 프로젝트의 SSH 진입점 `scripts/ops/ssh.sh` 는 연결 전에 이 머신의 주소를 **보안 그룹 인바운드 규칙에 추가**한다(스크립트 헤더에 "does that first, every time"). 읽기 전용 조사에서 AWS 리소스를 바꾸게 되므로 실행하지 않았다. 대신 12절에 James 가 실행할 읽기 명령을 적었다 |
| terraform state | 상태 파일은 읽지 않았다(민감값이 들어 있을 수 있다). 대신 IaC 선언과 라이브 값을 비교했고, 일일 드리프트 검사(`terraform.yml`)가 연 `terraform-drift` 이슈가 **한 건도 없음**을 확인했다 |

## 1. 한 장 요약

| 항목 | 값 | 근거 |
|---|---|---|
| EC2 | 1대: `insighta-k3s-1`, t3.medium, us-west-2c, 실행 중, 온디맨드(RI 적용) | 라이브 |
| RI | Standard 1건: t3.medium × 1, Regional, 1년(2026-04-16 ~ **2027-04-16**), All Upfront $213 | 라이브 |
| Savings Plan | 없음 | 라이브 |
| k8s | **k3s 1노드**(EKS 아님, 전 리전 EKS 클러스터 0) | 라이브 + IaC |
| T3 크레딧 | **unlimited**. 최근 30일 초과 크레딧 청구 0, 크레딧 잔액은 상한(576) | 라이브 |
| NAT Gateway | 0 | 라이브(17개 리전) |
| Elastic IP / 퍼블릭 IPv4 | EIP 1(인스턴스에 연결), 사용 중 퍼블릭 IPv4 1 | 라이브 |
| 로드 밸런서 | 0(us-west-2) | 라이브 |
| EBS | gp3 20GB 1개 + 스냅샷 1개(20GB, 2026-04-16 AMI 생성 시) | 라이브 |
| 청구(세금 포함, UnblendedCost) | 9월 $11.26 · 10월 $12.30 · 11월 1~4일 $1.30 | CUR |
| RI 일할 상각 | 9월 $17.51 · 10월 $18.09 | CUR(`reservation/EffectiveCost` 합) |
| 실효 월 비용(청구 + RI 상각) | 9월 약 $28.8 · 10월 약 $30.4 | 산술. Keel 예산 $40 안 |

## 2. EC2 인스턴스 (요청 1)

| 항목 | IaC | 라이브 | 일치 |
|---|---|---|---|
| 인스턴스 수 | k3s 노드 1 (`k3s_node_count = 1`). 옛 prod 인스턴스는 `enable_prod_instance = false` 로 만들지 않음 | 17개 리전 전체에서 **1대** | 일치 |
| 이름 / 용도 | `insighta-k3s-1`, 태그 `Role=k3s-validation`, `Phase=P2` | `insighta-k3s-1` (실행 중) | **태그 `Role` 이 현재 용도(prod 서비스 노드)와 다르다** |
| 타입 | t3.medium (2 vCPU, 4GiB) | t3.medium | 일치 |
| AZ | 선언 없음(서브넷 고정, 기본 VPC) | us-west-2c | IaC 에 AZ 값이 없다 |
| 구매 옵션 | 온디맨드. `instance_market_options`/`spot_price` 없음 | `InstanceLifecycle` 기본값(온디맨드). **RI 가 청구 단계에서 적용** | 일치 |
| 루트 볼륨 | gp3, 크기는 모듈 변수 기본값(tfvars 에서 미지정, 기본값은 읽지 않음) | gp3 20GB, 3000 IOPS, 125 MB/s | IaC 값 미확인 |
| 퍼블릭 IP | EIP 1개 연결 + `associate_public_ip_address = true` | 퍼블릭 IP 1 | 일치 |
| user_data | `ignore_changes` (노드 설정은 `scripts/ops/k3s-node-setup.sh`) | — | — |
| 드리프트 이력 | `terraform.yml` 주석: 과거 state 와 tfvars 가 `t2.micro` 였는데 실제는 `t3.medium` 이었던 적 있음 | — | 현재는 일치. 일일 드리프트 검사 이슈 0건 |
| Ansible | 호스트 `insighta-ec2` 1개(옛 compose 호스트) | 해당 인스턴스 없음 | **인벤토리가 죽은 호스트를 가리킨다** |
| 옛 문서 | `docs/DEPLOYMENT.md` 는 compose 호스트를 t3.medium 온디맨드 월 약 $30.37 로 서술 | — | 낡은 서술 |

다른 계정: `admin2` 프로파일이 있으나 **자격 증명이 무효**(`InvalidClientTokenId`)라 어느 계정인지 확인하지 못했다. 같은 계정이 아니면 이 문서 밖에 리소스가 있을 수 있다 → 12절.

## 3. 예약 구매 (요청 2)

| 항목 | 값 |
|---|---|
| Savings Plan | **없음**(`savingsplans describe-savings-plans`) |
| Reserved Instance | 1건, 상태 active |
| 유형 | Standard, Linux/UNIX, 테넌시 default |
| 범위 | **Regional** (AZ 고정 아님) |
| 인스턴스 | t3.medium × 1 |
| 기간 | 31,536,000초(1년). 2026-04-16 07:25 UTC ~ **2027-04-16 07:25 UTC** |
| 결제 | All Upfront, 선결제 $213, 시간당 반복 요금 $0 |
| 적용 | 9월 720시간, 10월 744시간 모두 `DiscountedUsage` → **인스턴스 시간의 100%** 가 RI 로 덮였다(CUR) |
| IaC | terraform 에 RI · Savings Plan 선언 없음 |
| 문서 | `docs/ops/k8s-migration-issue-checklist.md` 가 RI 를 기록하고 t3a/t4g 로 옮기면 RI 가 놀게 된다고 경고 |

## 4. Kubernetes 배포판 (요청 3)

- **k3s 이다. EKS 가 아니다.** 17개 리전 전부에서 EKS 클러스터 목록이 비어 있다(라이브). terraform 에도 `aws_eks_*` 가 없다.
- 노드 1개가 컨트롤 플레인 + 워크로드 + 인그레스 + EIP 를 겸한다. 데이터스토어는 SQLite(`docs/ops/datastore-sqlite-to-etcd.md`). 고가용성이 아니다(`variables.tf` 의 설명).
- **EKS 로 옮기는 경우를 비교할 때의 표기**: EKS 컨트롤 플레인 요금(시간당 $0.10)은 Savings Plans 할인 대상이 아니다. 이 문장은 AWS 가격 정책에 대한 지식이며 이 조사에서 확인한 사실이 아니다(현재 EKS 를 쓰지 않음).

## 5. 노드 allocatable 과 네임스페이스별 requests (요청 4)

**라이브 값은 조회하지 못했다**(0절). 아래는 IaC 로 계산한 값과 문서에 기록된 실측이다.

### 5.1 IaC 에서 계산한 requests 합계 (`charts/insighta/environments/*.yaml`)

| 네임스페이스 | 구성 | 메모리 requests 합 | CPU requests 합 |
|---|---|---|---|
| `insighta-prod` (`prod.yaml`) | api 2×(256Mi,100m), worker 1×(256Mi,100m), frontend 3×(32Mi,10m), redis 1×(64Mi,50m), Prometheus (192Mi,50m), exporter 2개 (24Mi + 48Mi, 10m씩), Grafana (64Mi,10m) | **1256Mi** (keel CronJob · provision Job 실행 중이면 각 +128Mi/+50m, 최대 1512Mi) | **460m** |
| `insighta-staging` (`staging.yaml`) | api 1×(192Mi,50m), worker 1×(128Mi,50m), frontend 1×(16Mi,10m), redis 1×(16Mi,10m). Keel · 메트릭 · Grafana 꺼짐 | **352Mi** (한도 합 928Mi, ResourceQuota requests 384Mi / limits 960Mi) | **120m** |
| `insighta-dev` (`dev.yaml`) | api · frontend · redis 각 1 + 기본 worker 1 | 608Mi | 260m |
| validation (`validation.yaml`, 네임스페이스 `insighta`) | api · worker · frontend 각 1 + 클러스터 내 postgres | 672Mi | 310m |
| preview | **없음** (PR 미리보기 환경이 존재하지 않음) | — | — |

- 계산 가정: Prometheus · node-exporter · kube-state-metrics 가 `values.yaml` 의 세 `metrics` 블록 순서와 같다고 보았다(추정). 스테이징 파일 주석("worker at 0 … 224Mi")과 같은 파일의 `worker.replicaCount: 1` 이 서로 다르다.
- `insighta-prod` Argo Application 은 `charts/bootstrap/applications.yaml` 에 없다(dev 와 validation 만). `projects.yaml` 에는 항목이 있다. 라이브 존재 여부는 미조회.
- dev · validation 이 클러스터에 **실제로 배포돼 있는지** 는 미조회. 배포돼 있다면 위 합계가 한 노드에 겹쳐 올라간다.

### 5.2 노드 allocatable (문서의 실측 기록, 라이브 아님)

| 값 | 출처 |
|---|---|
| 노드 메모리 약 3,836MB (2026-10-29 기록) | `docs/work-orders/WO-2026-10-29-staging-environment.md` |
| 가용 메모리 약 620MB (2026-10-29) → 약 344MB, 스왑 0 (2026-11-04) | 위 문서와 프로젝트 메모 |
| 인스턴스 사양: 2 vCPU, 4GiB | t3.medium |

IaC 합계(prod 1256Mi + stg 352Mi = 1608Mi, dev · validation 포함 시 2888Mi) 와 노드 메모리 3.75GiB 를 비교하면 여유가 작다. requests 합과 실제 사용량은 다른 값이므로 이 비교는 참고용이다.

## 6. stg 존재 여부와 위치 (요청 5)

| 항목 | 값 | 라벨 |
|---|---|---|
| 선언 | Argo Application `insighta-staging`, 브랜치 `deploy/staging`, 네임스페이스 `insighta-staging`, 자동 동기화 · prune · self-heal | IaC (`charts/bootstrap/staging-app.yaml`) |
| 호스트 | `stg.insighta.one` | IaC (`scripts/ops/build-stg-secret.py` 의 `STG_ORIGIN`) |
| 위치 | **prod 와 같은 노드**. 노드 선택 · 어피니티 · 톨러레이션 선언이 차트 어디에도 없다. 클러스터에 노드가 1개뿐이다(EC2 라이브 1대) | IaC + 라이브 |
| 실제 파드 상태 | 미조회 | 12절 |
| 데이터베이스 | 별도 Supabase 프로젝트(현재). WO-2026-11-03 은 DB 한 벌 공유로 바꾸는 계획(초안) | IaC · 문서 |

stg 와 prod 는 **같은 노드의 CPU · 메모리를 나눠 쓴다.** stg 의 부하 시험은 prod 파드와 자원을 경합한다.

## 7. 임베딩 호출 경로 (요청 6)

| 사실 | 근거 | 라벨 |
|---|---|---|
| 일괄 임베딩은 `IKS_EMBED_PROVIDER`(`ollama`\|`openrouter`, 기본 `ollama`), 위저드 목표 임베딩은 `MANDALA_EMBED_PROVIDER`(같은 값, 기본 `ollama`)로 선택. `MANDALA_EMBED_RACE=true` 면 OpenRouter 와 Mac Mini 를 경주시킨다 | `src/config/index.ts` L82-105 | IaC |
| 옛 compose 호스트 설정은 둘 다 `openrouter` + `RACE=true` (OpenRouter 라우팅 고정) | `docker-compose.prod.yml` L301-345 | IaC (옛 호스트) |
| `prod.yaml` · `staging.yaml` 에는 임베딩 변수가 없다. k3s 에서는 `insighta-env` Secret 에서 오며 **값은 repo 에 없다** | 차트 | IaC |
| 스테이징 Secret 빌더는 prod Secret 의 키를 그대로 복사하되 일부만 제외 · 강제 false 로 둔다. **임베딩 변수는 그 목록에 없다 → 스테이징은 prod 와 같은 임베딩 설정을 상속**한다. 스테이징은 자기 OpenRouter 키를 따로 쓴다 | `scripts/ops/build-stg-secret.py` L56-121 | IaC |
| Mac Mini Ollama 는 임베딩 말고도 쓰인다: 도메인 적합도 분류기 T3(`DOMAIN_FIT_SHADOW_OLLAMA_URL`), 만다라 생성 LoRA(`MANDALA_GEN_URL`), 자막(`MAC_MINI_TRANSCRIPT_URL`). 스테이징 빌더는 이 변수들을 강제로 끄지 않는다. 요약 크론은 스테이징에서 강제로 꺼져 있다 | 설정 · 빌더 | IaC |

**결론(조건부 표기)**: 코드상 prod 일괄 임베딩은 OpenRouter 이므로 메모의 "prod 임베드 = OpenRouter" 와 맞는다. 그러나 (가) 위저드 임베딩은 OpenRouter 와 Mac Mini 의 **경주**여서 Mac Mini 가 참가자이고, (나) T3 분류기와 생성 LoRA 는 Mac Mini Ollama 를 직접 쓰며, (다) 스테이징이 prod 와 같은 값을 상속한다. 따라서 **스테이징 파드가 Tailscale 로 같은 Mac Mini Ollama 에 닿는 구조라면, stg 의 성능 측정은 같은 Mac Mini 를 쓰는 prod 에 영향을 준다.** 실제 Secret 값과 파드의 도달 가능성은 확인하지 못했다(미조회, 12절). 별개로, stg 와 prod 는 같은 노드를 쓰므로 CPU · 메모리 경합은 Mac Mini 와 무관하게 존재한다.

## 8. T3 크레딧, 네트워크 주소 (요청 7 · 8)

### 8.1 T3 크레딧 모드

| 항목 | 값 |
|---|---|
| IaC | `credit_specification` · `cpu_credits` 선언 없음 → AWS 기본값에 맡김 |
| **라이브** | **unlimited** |
| 최근 30일 `CPUSurplusCreditsCharged` | 최대 0, 합 0 |
| `CPUSurplusCreditBalance` | 0 |
| `CPUCreditBalance` | 576 (t3.medium 상한, 최근 5일 일 최대값) |
| `CPUUtilization` 일 평균 | 약 15.2% ~ 16.9% (10-30 ~ 11-03) |

참고: T3 는 API 로 띄우면 기본이 unlimited 이다(AWS 문서에 대한 지식). 따라서 IaC 가 선언하지 않아도 unlimited 가 된다. unlimited 는 평균 CPU 가 기준선(t3.medium 20%)을 지속적으로 넘기면 vCPU 시간당 추가 요금이 붙고, 이 추가 요금은 RI 로 덮이지 않는다(AWS 문서에 대한 지식, 미검증). 현재는 평균 15~17% 로 기준선 아래이고 청구는 0 이다.

### 8.2 NAT Gateway · Elastic IP · 퍼블릭 IPv4

| 항목 | 값 | 라벨 |
|---|---|---|
| NAT Gateway | **0** (17개 리전 모두, 삭제 상태 제외) | 라이브 |
| Elastic IP | **1** (us-west-2, 인스턴스에 연결) | 라이브 (IaC 선언 1 과 일치. 대기 EIP `prod_standby` 는 `count = 0`) |
| 퍼블릭 IPv4 (네트워크 인터페이스) | **1** (EIP 가 곧 그 주소) | 라이브 |
| 로드 밸런서 | 0 (us-west-2) | 라이브 |
| 퍼블릭 IPv4 요금 | 9월 $3.60 (720h), 10월 $3.72 (744h) = 시간당 $0.005 × 1 주소 | CUR (산술 일치) |

## 9. 최근 2개월 서비스별 청구액 (요청 9)

출처: CUR(`insighta-daily-cost`) 9월 · 10월 전체와 11월 1~4일. `UnblendedCost` 기준이며 세금이 별도 행으로 포함된다. Cost Explorer API 는 쓰지 않았다.

| 서비스 | 2026-09 | 2026-10 | 2026-11 (1~4일 누계) |
|---|---|---|---|
| Amazon S3 | $3.87 | **$4.82** | $0.53 |
| Amazon VPC (퍼블릭 IPv4) | $3.96 | $4.09 | $0.43 |
| Amazon EC2 (EBS · 스냅샷 · 전송) | $3.26 | $3.27 | $0.33 |
| ECR | $0.09 | $0.09 | $0.01 |
| Data Transfer | $0.04 | $0.04 | — |
| Cost Explorer | $0.03 | — | — |
| **합계** | **$11.26** | **$12.30** | **$1.30** |
| (그중 세금) | $1.02 | $1.12 | $0.12 |

| 세부 항목 | 9월 | 10월 | 산술 확인 |
|---|---|---|---|
| 퍼블릭 IPv4 사용 중 | $3.60 | $3.72 | 시간당 $0.005 × 720h · 744h |
| EBS gp3 20GB | $1.60 | $1.60 | 20GB × $0.08 |
| EBS 스냅샷 | $0.99 | $0.99 | 20GB × $0.05 |
| S3 저장 (`TimedStorage`) | $3.41 | $4.23 | 205GB × $0.023 ≈ $4.7 (10월 평균 기준 근사) |
| 리전 내 데이터 전송 | $0.41 | $0.41 | — |

**RI 비용**: 선결제 $213 은 2026-04-16 에 지불되어 위 월별 청구에 나타나지 않는다. CUR 의 RI 일할 상각(`reservation/EffectiveCost`)은 9월 $17.51(30일), 10월 $18.09(31일)로 $213 ÷ 365 × 일수와 일치한다.

| | 9월 | 10월 |
|---|---|---|
| 청구(UnblendedCost) | $11.26 | $12.30 |
| RI 상각 | $17.51 | $18.09 |
| **실효 월 비용** | **$28.77** | **$30.39** |
| Keel 월 예산(`AWS_MONTHLY_BUDGET_USD` 기본값) | $40 | $40 |

CUR 의 공개 온디맨드 환산 합(`pricing/publicOnDemandCost`)은 9월 $43.59, 10월 $46.41 이다. 이 합은 모든 사용량 행을 정가로 환산한 값이라 인스턴스 시간만의 절감액과는 다르다.

AWS 밖의 비용(Supabase 플랜, Mac Mini, OpenRouter, 도메인 등)은 이 문서의 범위가 아니다.

## 10. 관찰 (변경하지 않음)

| # | 관찰 | 근거 |
|---|---|---|
| O1 | **`insighta-backups` 버킷 용량의 84% 는 이전 버전이다.** 현재 객체 33개 36.8GB, 이전 버전 213개 **173.3GB**, 삭제 표시 213개. 버전 관리가 켜져 있고 라이프사이클 규칙(`backup-lifecycle`)은 현재 버전을 90일에 만료시킬 뿐 **이전 버전 만료 규칙이 없다**. 백업 워크플로가 오래된 객체를 삭제하면 이전 버전이 남는다 | 라이브(`list-object-versions`, 라이프사이클, CloudWatch 205.3GB Standard + 2.4GB IA) |
| O2 | O1 이 사실이라면 매일 약 1.3GB 가 쌓이므로 S3 저장 비용은 달마다 약 $0.9 씩 늘어난다(38GB × $0.023). 9월 $3.87 → 10월 $4.82 가 이 방향이다 | 산술. 증가 속도는 추정 |
| O3 | EBS 스냅샷 1개(20GB)는 2026-04-16 에 옛 prod 인스턴스에서 AMI 를 만들 때 생겼다(월 $0.99). 옛 prod 인스턴스는 만들지 않는 상태다 | 라이브 |
| O4 | 인스턴스 `Role` 태그가 `k3s-validation` 이다. 실제로는 prod 서비스 노드다 | IaC + 라이브 |
| O5 | Ansible 인벤토리와 `docs/DEPLOYMENT.md` 가 없어진 호스트를 가리킨다 | IaC · 문서 |
| O6 | `admin2` 프로파일 자격 증명이 무효다. 보유 계정이 둘이면 두 번째 계정은 조사되지 않았다 | 라이브 |

## 11. 선구매 결정에 영향을 주는 사실

(권고가 아니라 확인된 사실의 모음이다.)

- 컴퓨트는 **t3.medium 1대**이고, 이를 덮는 Standard RI 가 **2027-04-16 까지** 100% 활용된다. Savings Plan 은 없다.
- Standard RI 는 인스턴스 패밀리 변경 시 가치를 잃는다(문서 `k8s-migration-issue-checklist.md` 의 t3a/t4g 경고). Regional 범위라 AZ 는 무관하다. 크기 유연성(같은 패밀리 안)은 AWS 문서에 대한 지식이며 미검증.
- 노드를 늘리면 새 인스턴스는 **온디맨드 가격**이다(RI 는 t3.medium 1대분). 노드 증설은 규칙 R32(개정안 #1768)의 승인 대상이다.
- 월 현금 청구는 약 $12 이고, 그중 컴퓨트 외 항목(S3 · 퍼블릭 IPv4 · EBS)이 대부분이다. RI 상각이 월 약 $18 이다.
- 노드 메모리 여유가 작다(가용 약 344MB, 2026-11-04 기록). 증설 논의의 동기는 비용이 아니라 용량이다.
- EKS 를 쓰지 않으므로 컨트롤 플레인 요금은 없다. EKS 로 전환하면 컨트롤 플레인 시간당 $0.10 이 추가되고 Savings Plans 할인 대상이 아니다.

## 12. James 확인 필요 (조회하지 못한 항목)

| # | 항목 | 이유 | 명령 또는 확인처 |
|---|---|---|---|
| 1 | 노드 allocatable, 네임스페이스별 requests, 실제 파드 배치 (요청 4 · 5) | `ssh.sh` 가 보안 그룹을 변경함 | `bash scripts/ops/ssh.sh k3s "sudo k3s kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEM:.status.allocatable.memory"` 와 `... "sudo k3s kubectl describe node insighta-k3s-1"` 의 `Allocated resources` 절, `... "sudo k3s kubectl get pods -A -o wide"`. **이 명령은 연결 전에 보안 그룹에 인바운드 규칙을 추가한다** — 실행 여부는 James 판단 |
| 2 | 네임스페이스별 requests 합 (미실행 초안) | 같은 이유 | `bash scripts/ops/ssh.sh k3s "sudo k3s kubectl get pods -A -o json"` 출력을 로컬 `jq` 로 집계. 메모리 단위(Ki · Mi · Gi)와 CPU 단위(m)를 변환하는 `jq` 식이 필요하며 아직 작성 · 시험하지 않았다 |
| 3 | 실제 임베딩 설정 (요청 6) | 같은 이유 + Secret 조회 | 키 **이름과 비밀이 아닌 설정값**만: `... "sudo k3s kubectl -n insighta-prod get secret insighta-env -o json"` 에서 `IKS_EMBED_PROVIDER`, `MANDALA_EMBED_PROVIDER`, `MANDALA_EMBED_RACE` 의 값, 그리고 Mac Mini URL 변수(`OLLAMA` · `MAC_MINI` · `MANDALA_GEN` 이 들어간 키)의 **존재 여부만**. 스테이징 네임스페이스도 같게. Secret 이름 `insighta-env` 는 스테이징 기준이며 prod 도 같은지는 미확인 |
| 4 | 스테이징 파드가 Mac Mini 에 닿는지 | 파드 안에서의 네트워크 시험이 필요 | 실행 금지 항목으로 두었다(운영 노드에서 시험). 필요하면 별도 승인 |
| 5 | Argo Application `insighta-prod` 의 라이브 존재 · 동기화 | 클러스터 조회 필요 | `... "sudo k3s kubectl -n argocd get applications"` |
| 6 | dev · validation 네임스페이스가 배포돼 있는지 | 클러스터 조회 필요 | `... "sudo k3s kubectl get ns"` |
| 7 | `admin2` 프로파일 | 자격 증명 무효 | 어느 계정인지, 이 문서 밖에 리소스가 있는지 James 확인 |
| 8 | AWS 밖 비용 | 범위 밖 | Supabase 플랜, Mac Mini, OpenRouter 등의 월 비용은 각 콘솔 |
| 9 | 청구서와 CUR 의 일치 | CUR 은 사용량 기반 | Billing 콘솔의 청구서 금액과 9절 합계 대조 |
| 10 | 현재 월 (11월) 최종 청구 | 4일치뿐 | 월말 CUR |

## 13. 이 문서가 한 일과 하지 않은 일

- 한 일: AWS 읽기 호출(EC2, 예약 구매, EKS, CloudWatch, S3 목록 · 버전, EBS, NAT · EIP · ENI, 로드 밸런서), CUR 파일 읽기, `gh` 로 드리프트 이슈 조회.
- 하지 않은 일: 리소스 생성 · 변경 · 삭제, SSH 접속, kubectl 실행, terraform state 읽기, Cost Explorer API 호출, 비밀 값 출력.
- 읽기 호출 중 과금이 생기는 것은 S3 목록 요청(건당 매우 작음)과 CloudWatch 메트릭 조회(건당 매우 작음)뿐이다.
