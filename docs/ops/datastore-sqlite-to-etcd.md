# k3s 데이터스토어 전환: SQLite → 내장 etcd

작성 2026-08-19 · 상태 **계획(미실행)** · 대상 `insighta-k3s-1`, `insighta-k3s-2`

이 문서는 왜 바꾸는지, 어떻게 바꾸는지, 바꾼 뒤 형상이 어떻게 되는지를 기록한다.
절차는 아직 실행하지 않았다. 실행 시 각 단계의 실제 출력을 §6 에 append 한다.

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

### 4-1. 리허설 (폐기용 노드)

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
TOKEN=$(ssh server1 sudo cat /var/lib/rancher/k3s/server/node-token)
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.36.3+k3s1 \
  K3S_TOKEN="$TOKEN" sh -s - server \
  --server https://<서버1 사설주소>:6443 \
  --disable traefik --disable servicelb \
  --write-kubeconfig-mode 644

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

절차를 실행할 때 각 단계의 실제 명령과 출력을 아래에 append 한다.
계획과 실제가 달랐던 지점을 반드시 남긴다.

```
(미실행)
```

---

## 7. 최종 형상 (전환 완료 후 이 절을 채운다)

전환이 끝나면 아래를 실측값으로 채운다.

| 항목 | 전환 전 | 전환 후 |
|---|---|---|
| 데이터스토어 | SQLite (`state.db` 11MB) | |
| 서버 노드 | 1 | |
| 견딜 수 있는 서버 정지 | 0대 | |
| 시크릿 암호화 | Disabled | |
| 진입점 | 노드1 단독 | |
| etcd 스냅샷 | 없음 | |
| 재구축 수동 단계 | 시크릿 144키 | |
