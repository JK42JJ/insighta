# k3s 데이터스토어 전환: SQLite → 내장 etcd

작성 2026-08-19 · 상태 **리허설 완료 · 본 전환 보류(SQLite 유지 결정)** · 대상 `insighta-k3s-1`

이 문서는 왜 바꾸는지, 어떻게 바꾸는지, 바꾼 뒤 형상이 어떻게 되는지를 기록한다.
2026-08-19 에 리허설을 완주했고 결함 2건을 찾아 §4 절차에 반영했다. 실행 기록은
§6-1 에 있다. 본 전환은 아직 하지 않았다.

**결정 (2026-08-19, James)**

리허설 결과를 받고 **SQLite 를 유지**하기로 했다. 근거는 비용이다.

etcd 로 옮기는 것과 서버를 3대로 늘리는 것은 분리되지 않는다. etcd 1대는 SQLite
1대와 가용성이 같고(제어평면이 여전히 단일 장애점), 리허설에서 측정한 쿼럼 이득은
3대에서만 생긴다. 즉 "etcd 로 간다" 는 곧 "t3.medium 3대, 비용 약 2배" 다.

| 구성 | 제어평면 이중화 | 스냅샷 | 시크릿 암호화 | 월 비용 |
|---|---|---|---|---|
| SQLite 1대 (채택) | 없음 | 없음 | 불가 | 기준 |
| etcd 1대 | 없음 (동일) | 가능 | 가능 | 기준 |
| etcd 3대 | 1대 정지 견딤 | 가능 | 가능 | 약 2배 |

따라서 이 문서의 §4 절차는 **실행하지 않는다.** 보류이지 폐기가 아니며, 아래 조건 중
하나가 성립하면 다시 꺼낸다.

- 다운타임 비용이 서버 2대 값을 넘어설 때
- 시크릿 평문 저장이 규정상 허용되지 않게 될 때
- 클러스터 상태 백업(스냅샷)이 필요해질 때

**보류로 인해 남는 것** — 아래는 SQLite 유지의 대가이며, 알고 감수하는 항목이다.

| 항목 | 상태 |
|---|---|
| 제어평면 이중화 | 없음. 노드1 정지 = 서비스 중단 |
| 시크릿 암호화 | 불가. `state.db` 안에 base64 로만 존재 |
| 클러스터 상태 스냅샷 | 없음. SQLite 는 k3s 의 etcd 스냅샷 대상이 아님 |
| 재구축 시 상태 복원 | git + 시크릿 수동 주입에 전적으로 의존 |

**현재 상태 (2026-08-19 리허설 후)**

| 대상 | 상태 |
|---|---|
| `insighta-k3s-1` (프로드) | SQLite 단일 서버. 파드 20개 전량 이 노드에서 Running |
| `insighta-k3s-2` | **terminated.** `k3s_node_count` 2→1 로 terraform 에서 제거 |
| 임시 인스턴스 2대 | terminated. 리허설 전용 보안그룹도 삭제 |
| terraform drift | 없음 (`No changes`) |
| 월 비용 | t3a.small 제거로 약 $14 절감 |

프로드는 리허설 전후로 무중단이었다. drain 중 `curl` 90회 전부 200.

---

## 1. 왜 바꾸는가

### 1-1. 현재 상태 (2026-08-19 실측)

```
$ sudo ls -la /var/lib/rancher/k3s/server/db/
-rw-r--r-- 1 root root 11472896 Aug 19 00:03 state.db
-rw-r--r-- 1 root root    32768 Aug 19 00:04 state.db-shm
-rw-r--r-- 1 root root  8689112 Aug 19 00:04 state.db-wal

$ sudo systemctl cat k3s | grep -A6 ExecStart
ExecStart=/usr/local/bin/k3s \
    server \
	'--disable' 'traefik' \
	'--disable' 'servicelb' \
	'--write-kubeconfig-mode' '644'

$ sudo systemctl cat k3s | grep -cE 'cluster-init|datastore-endpoint'
0
```

`state.db` 가 존재하고 `--cluster-init` · `--datastore-endpoint` 가 모두 없다.
**SQLite 단일 서버 모드**로 확정된다.

### 1-2. 이 상태에서 불가능한 것

k3s 바이너리가 지원하는 데이터스토어 옵션을 직접 확인하면 다음과 같다.

```
$ k3s server --help | grep -E 'cluster-init|datastore-endpoint'
--cluster-init              (cluster) Initialize a new cluster using embedded Etcd
--datastore-endpoint value  (db) Specify etcd, NATS, MySQL, Postgres, or SQLite
```

서버 노드를 2대 이상 두려면 둘 중 하나가 필요하다. SQLite 는 다중 서버를 지원하지
않는다. 따라서 현재 구성에서는 **제어평면 이중화가 원천적으로 불가능**하다.

### 1-3. 인스턴스 크기를 올리면 해결되는가

해결되지 않는다. 인스턴스를 t3.small 에서 t3.medium 으로 올리는 것은 수직 확장이며
처리 용량만 늘어난다. 기계는 여전히 한 대이고, 그 한 대가 정지하면 서비스도 정지한다.
가용성과 용량은 다른 축이다.

### 1-4. 현재 단일 장애점

| 구성요소 | 위치 | 정지 시 영향 |
|---|---|---|
| k3s 서버 (제어평면) | 노드1 | 배포·스케줄링 중단 |
| SQLite 데이터스토어 | 노드1 | 클러스터 상태 소실 위험 |
| ingress-nginx | 노드1 | **외부 요청 전부 실패** |
| Elastic IP | 노드1 | 진입 경로 소멸 |
| cert-manager | 노드1 | 인증서 갱신 중단 (90일 내 전면 장애) |

노드2 가 정상이어도 노드1 이 정지하면 서비스가 중단된다.

---

## 2. 목표 형상

```
                        Elastic IP
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
         │ 서버 1  │    │ 서버 2  │    │ 서버 3  │
         │ etcd    │◄──►│ etcd    │◄──►│ etcd    │
         │ ingress │    │ ingress │    │ ingress │
         └─────────┘    └─────────┘    └─────────┘
              쿼럼 2/3 — 1대 정지를 견딘다
```

### 2-1. 왜 3대인가 (2대가 아니라)

etcd 는 쓰기를 과반 합의로 결정한다.

| 서버 수 | 쿼럼 | 견딜 수 있는 정지 | 판정 |
|---:|---:|---:|---|
| 1 | 1 | 0대 | 현재 상태 |
| **2** | **2** | **0대** | **1대보다 나쁨** |
| 3 | 2 | 1대 | 최소 HA |
| 5 | 3 | 2대 | 과잉 |

2대 구성은 둘 중 어느 하나만 정지해도 쿼럼(2)을 잃어 쓰기가 멈춘다. 1대일 때는
그 1대가 죽어야 멈추므로, **2대는 가용성이 오히려 내려간다.** 짝수 대 구성을
하지 않는 이유가 이것이다.

### 2-2. 비용

| 구성 | 인스턴스 | 월 비용(개략) |
|---|---|---|
| 현재 | t3.medium 1 + t3a.small 1 | 기준 |
| 목표 | t3.medium 3 | 기준 + 약 2배 |

비용 결정은 James 권한이다. 이 문서는 기술 조건만 정리한다.

---

## 3. 전환 방식 결정

### 3-1. 제자리 전환은 하지 않는다

기존 SQLite 클러스터에 `--cluster-init` 을 추가하는 방식은 채택하지 않는다.
데이터스토어 종류가 다르므로 기동 시 불일치가 발생하며, 실패 시 되돌릴 지점이
없다. **본 세션에서 이 동작을 검증하지 않았으므로 추정으로 절차에 넣지 않는다.**

### 3-2. 채택 방식: 신규 클러스터 + GitOps 복원 + EIP 이동

커트오버 때 검증된 방식을 그대로 쓴다.

1. 새 서버 3대에 etcd 모드로 클러스터를 구성한다
2. ArgoCD 를 설치하고 같은 git 저장소를 가리킨다 — 워크로드가 자동 복원된다
3. 시크릿을 주입한다 (현재 수동, §5-2 참조)
4. 검증 후 Elastic IP 를 새 클러스터로 재연결한다 (약 2초)
5. 문제 발생 시 EIP 를 원위치 — 기존 클러스터는 그대로 살아 있다

**이 방식의 이점**: 기존 클러스터를 건드리지 않으므로 롤백이 EIP 재연결 한 번이다.
GitOps 를 도입해 둔 것이 여기서 값을 한다 — 워크로드 정의가 git 에 있으므로
클러스터를 새로 만들어도 같은 상태가 재현된다.

---

## 4. 절차

각 단계는 **판정 기준**을 통과해야 다음으로 넘어간다.

### 4-0. 선행 — 보안그룹에 etcd 포트 추가

`terraform/modules/k3s-node/main.tf` 의 보안그룹에 자기참조 인그레스를 추가한다.
없으면 조인이 timeout 으로 실패한다 (§6-1 결함 2).

```hcl
ingress {
  description = "etcd client and peer, between servers"
  from_port   = 2379
  to_port     = 2380
  protocol    = "tcp"
  self        = true
}
```

**판정**: `aws ec2 describe-security-groups` 출력에 2379-2380 이 보일 것.

### 4-1. 리허설 (폐기용 노드) — 2026-08-19 완료

prod 에 적용하기 전에 폐기 가능한 인스턴스에서 1회 완주한다. 리허설 없이 prod 에
적용하지 않는다.

```bash
# 1. 폐기용 t3.small 3대 기동 (terraform 별도 워크스페이스)
# 2. 아래 4-2 전 과정을 그대로 수행
# 3. 서버 1대를 강제 정지시켜 쿼럼 유지 확인   ← 리허설의 핵심
# 4. 소요 시간 측정 → prod 작업 창 산정 근거
```

**판정**: 서버 1대 정지 상태에서 `kubectl get nodes` 가 응답하고 파드가 계속
Running 이면 통과.

### 4-2. 신규 클러스터 구성

```bash
# 서버 1 — 클러스터 초기화
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.36.3+k3s1 sh -s - server \
  --cluster-init \
  --disable traefik --disable servicelb \
  --write-kubeconfig-mode 644 \
  --secrets-encryption \
  --etcd-snapshot-schedule-cron '0 */6 * * *' \
  --etcd-snapshot-retention 20

# 판정: 아래가 etcd 를 보고해야 한다
sudo k3s kubectl get --raw /readyz?verbose | grep etcd
sudo ls /var/lib/rancher/k3s/server/db/etcd/    # 디렉터리 존재
sudo test -f /var/lib/rancher/k3s/server/db/state.db && echo "SQLite 잔존 — 중단"

# 서버 2, 3 — 조인
# --secrets-encryption 을 빠뜨리면 조인이 fatal 로 죽는다 (§6-1 결함 1).
# 전 서버가 동일한 값을 가져야 하는 critical 설정이다.
TOKEN=$(ssh server1 sudo cat /var/lib/rancher/k3s/server/node-token)
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.36.3+k3s1 \
  K3S_TOKEN="$TOKEN" sh -s - server \
  --server https://<서버1 사설주소>:6443 \
  --disable traefik --disable servicelb \
  --write-kubeconfig-mode 644 \
  --secrets-encryption

# 판정: 3대가 모두 control-plane,etcd 역할로 Ready
sudo k3s kubectl get nodes -o wide
sudo k3s kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name} {.metadata.labels}{"\n"}{end}' | grep -c etcd   # 3 이어야 함
```

### 4-3. 시크릿 암호화 활성화 (현재 미적용 상태 해소)

현재 클러스터는 설정 파일에 `secrets-encryption: true` 가 있으나 실제 상태는
`Disabled` 다. 신규 구성에서는 기동 인자로 넣고 **반드시 상태를 확인**한다.

```bash
sudo k3s secrets-encrypt status
# 판정: Encryption Status: Enabled

# 음성 대조 — 실제로 암호화되는지 원본에서 확인
sudo grep -c 'k8s:enc:' /var/lib/rancher/k3s/server/db/etcd/member/snap/db
# 판정: 0 이 아니어야 한다. 0 이면 설정만 되고 적용은 안 된 것
```

**이 음성 대조를 생략하지 않는다.** 현재 클러스터가 정확히 "설정은 켜져 있는데
실제로는 꺼져 있는" 상태이고, 상태 확인을 하지 않아서 여태 몰랐다.

### 4-4. 부트스트랩 + 워크로드 복원

```bash
# ingress-nginx / cert-manager / ArgoCD
sudo k3s kubectl apply -f charts/bootstrap/
sudo k3s kubectl apply -f charts/bootstrap/ingress-nginx-config.yaml

# 판정
sudo k3s kubectl -n ingress-nginx get pods
sudo k3s kubectl -n argocd get applications
```

### 4-5. 시크릿 주입

```bash
# 144키. 현재 수동. 상세는 §5-2
sudo k3s kubectl -n insighta-prod create secret generic insighta-env --from-env-file=<파일>

# 판정: 키 개수 일치
sudo k3s kubectl -n insighta-prod get secret insighta-env -o json | python3 -c \
  "import json,sys; print(len(json.load(sys.stdin)['data']))"   # 144
```

### 4-6. 검증 후 EIP 이동

```bash
# 클러스터 내부에서 먼저 확인 (외부 트래픽 없이)
sudo k3s kubectl -n insighta-prod get pods          # 전부 Running
sudo k3s kubectl -n insighta-prod exec deploy/insighta-api -- curl -s localhost:3000/health

# EIP 재연결 (terraform)
terraform -chdir=terraform/projects/insighta/environments/prod plan   # 항목 확인 필수
terraform -chdir=terraform/projects/insighta/environments/prod apply

# 판정 (외부에서)
curl -s -o /dev/null -w '%{http_code}\n' https://insighta.one/health      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://www.insighta.one/health  # 200
curl -sI https://insighta.one | grep -ciE 'strict-transport|x-content-type|x-frame|x-xss|referrer-policy'  # 5
```

### 4-7. 롤백

EIP 를 기존 클러스터로 되돌린다. 기존 클러스터는 이 절차 동안 계속 살아 있다.

```bash
# terraform 에서 eip_instance_id 를 기존 노드로 되돌리고 apply
# 소요: 약 2초. DNS 무관.
```

---

## 5. 함께 처리할 항목

전환은 클러스터를 새로 만드는 작업이므로, 현재 미해결 항목 중 이 시점에 같이
해소해야 유리한 것들이 있다.

### 5-1. ingress DaemonSet 화

서버가 3대가 되어도 ingress 가 1대에만 있으면 진입점은 여전히 단일 장애점이다.
Deployment 를 DaemonSet 으로 바꾸면 3대 모두가 진입점이 된다. 추가 비용 0.

### 5-2. 시크릿 144키 수동 주입 해소

현재 재구축 시간의 대부분이 이 단계다. 144키 중 실제 비밀은 API 키·DB 접속 문자열
정도이고 나머지는 기능 플래그와 임계값이다.

접두어별 분포 (2026-08-19 실측):
```
V3 14 · YOUTUBE 14 · V5 10 · REDIS 7 · LEMONSQUEEZY 6 · OPENROUTER 5
BOOK 4 · DISCOVER 4 · MANDALA 4 · SUPABASE 4 · BATCH 3 · CURATION 3
```

두 갈래로 나누는 것이 정답이다.
- **설정값** (`BOOK_GATE_MODE`, `BATCH_COLLECTOR_LIMIT`, `CURATION_SCHED_KST_ENABLED` 등)
  → ConfigMap 또는 차트 values 로 이동. git 에서 관리 가능해진다.
- **진짜 비밀** (API 키, DB 접속 문자열) → External Secrets Operator 로 외부 보관소에서 주입

### 5-3. 이미지 태그 고정

`latest` 를 커밋 SHA 로 바꾸는 작업. 새 클러스터에서 시작하면 기존 캐시가 없으므로
전환과 함께 적용하기 좋다. 상세는 별도 항목.

---

## 6. 실행 기록

### 6-1. 리허설 (2026-08-19, 실행 완료)

노드2(`insighta-k3s-2`)를 프로드에서 분리해 etcd 서버로 전환하고, 임시 t3a.small
2대를 붙여 3노드 쿼럼까지 확인했다. 소요 약 40분, 비용 약 $0.02.

#### 단계별 결과

| 단계 | 결과 | 측정값 |
|---|---|---|
| 사전 용량 검증 | PASS | 노드1 실사용 1,770Mi/3,837Mi, 노드2 파드 521Mi → 이전 후 2,291Mi(60%) |
| cordon + drain | PASS | **7.5초**, 파드 6개 이전, `curl` 90회 **전부 200** |
| 노드2 분리 | PASS | `kubectl delete node` 후 프로드 1노드, 파드 전량 Running |
| etcd 모드 설치 | PASS | `db/etcd` 존재, `state.db` 없음, role=`control-plane,etcd` |
| 시크릿 암호화 | PASS | `Encryption Status: Enabled` + 음성 대조 통과 |
| 서버 2·3 조인 | **1차 FAIL → 수정 후 PASS** | 아래 결함 1 |
| etcd 피어 통신 | **FAIL → 수정 후 PASS** | 아래 결함 2 |
| 쿼럼 유지 (1대 정지) | PASS | 읽기·쓰기 모두 정상 |
| 쿼럼 상실 (2대 정지) | PASS | 쓰기 거부, 읽기 무응답 |
| 복구 | PASS | 3노드 Ready, 정지 전 데이터 보존 확인 |
| etcd 스냅샷 | PASS | 수동 저장 3.8MB |
| 정리 | PASS | 임시 2대 terminated, 리허설 SG 삭제 |

#### 결함 1 — `--secrets-encryption` 은 전 서버가 동일해야 한다

첫 서버에만 주고 2·3번을 조인시키면 기동이 죽는다.

```
level=warning msg="critical configuration mismatched: secrets-encryption"
level=fatal   msg="Error: preparing server: failed to bootstrap cluster data:
              failed to validate server configuration:
              critical configuration value mismatch between servers"
```

**조치**: 조인하는 모든 서버의 설치 인자에 `--secrets-encryption` 을 동일하게 넣는다.
§4-2 의 서버 2·3 명령에 반영해야 한다(현재 문서에는 빠져 있었다).

**prod 에서 바로 했다면**: 1번 서버는 정상 기동하고 2·3번만 조인 실패한다. 겉으로는
"HA 구성 중 노드가 안 붙음" 으로 보이고, 원인이 암호화 플래그라는 것은 journal 을
읽기 전에는 드러나지 않는다.

#### 결함 2 — 보안그룹에 etcd 포트가 없다

플래그를 맞춘 뒤에도 조인이 안 됐다.

```
level=error msg="Failed to check local etcd status for learner management:
                 context deadline exceeded"
```

`sg-071c0c18e5bb98e1b` 의 인바운드를 확인한 결과:

```
6443  apiserver   자기참조   있음
8472  flannel     자기참조   있음
10250 kubelet     자기참조   있음
2379  etcd client            없음   ←
2380  etcd peer              없음   ←
```

단일 서버 전제로 작성된 규칙이라 etcd 포트가 빠져 있었다.

**조치**: `terraform/modules/k3s-node/main.tf` 의 보안그룹에 자기참조
2379-2380/tcp 인그레스를 추가한다. 리허설에서는 프로드 SG 를 건드리지 않기 위해
임시 SG 를 따로 만들어 우회했고, 종료 시 삭제했다.

**prod 에서 바로 했다면**: 결함 1을 고친 뒤에도 조인이 안 되고, 로그는 timeout 만
보여 준다. 방화벽이 원인이라는 단서가 에러 메시지에 없다.

#### 확인된 사실 — 쿼럼

| 생존 서버 | 쓰기 | 읽기 |
|---:|---|---|
| 3 / 3 | 성공 | 정상 |
| 2 / 3 | **성공** | 정상 |
| 1 / 3 | **거부** | 무응답 |

§2-1 의 "2대는 1대보다 나쁘다" 를 실물로 확인했다. 3대 중 2대가 죽으면 남은 1대가
살아 있어도 클러스터는 멈춘다. 서버 2대 구성이면 1대만 죽어도 같은 상태가 된다.

#### 확인된 사실 — 시크릿 암호화

현재 프로드는 `config.yaml` 에 `secrets-encryption: true` 가 있는데도 상태가
`Disabled` 다. 리허설에서 설치 인자로 주었을 때는 `Enabled` 이고, 음성 대조도
통과했다.

```
$ k3s kubectl create secret generic rehearsal-probe --from-literal=canary=<문자열>
$ grep -a '<문자열>' .../db/etcd/member/snap/db     → 없음   PASS
$ grep -ac 'k8s:enc:' .../db/etcd/member/snap/db    → 4      PASS
```

설정 파일에 값이 있는 것과 기능이 켜진 것은 다르다. `k3s secrets-encrypt status`
로 확인하고, 원본에서 평문을 검색하는 음성 대조까지 해야 확정된다.

#### 리허설이 잡아낸 것의 요약

프로드에 바로 적용했다면 결함 1과 2를 운영 중에 순차로 만났을 것이다. 각각 로그를
읽어야만 원인이 드러나고, 그동안 제어평면은 단일 서버 상태로 남는다.

### 6-2. 본 전환 (미실행)

```
(대기)
```

---

## 7. 최종 형상 (전환 완료 후 이 절을 채운다)

전환이 끝나면 아래를 실측값으로 채운다.

| 항목 | 전환 전 (현 프로드) | 리허설에서 확인한 전환 후 | 본 전환 후 (실행 시 기입) |
|---|---|---|---|
| 데이터스토어 | SQLite (`state.db` 11MB) | etcd (`db/etcd`, `state.db` 없음) | |
| 서버 노드 | 1 | 3 | |
| 견딜 수 있는 서버 정지 | 0대 | **1대** (2/3 생존 시 읽기·쓰기 정상) | |
| 시크릿 암호화 | Disabled (설정만 존재) | **Enabled** (음성 대조 통과) | |
| 진입점 | 노드1 단독 | 미변경 — §5-1 DaemonSet 별도 | |
| etcd 스냅샷 | 없음 | 생성 확인 (3.8MB) | |
| 재구축 수동 단계 | 시크릿 144키 | 동일 — §5-2 미해소 | |
