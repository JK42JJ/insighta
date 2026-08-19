# 인프라 실습

`docs/guides/infra-for-beginners` 가이드와 짝을 이루는 실행 가능한 실습이다.
가이드가 설명이라면 이쪽은 손으로 확인하는 부분이다.

## 순서

| 랩 | 주제 | 성격 | 소요 |
|---|---|---|---|
| `lab01-server-and-ssh.sh` | 서버 한 대에 들어가 보기 | 읽기 전용 | 2분 |
| `lab02-containers-and-images.sh` | 컨테이너 · 이미지 · ECR | 읽기 전용 | 3분 |
| `lab03-kubernetes-objects.sh` | 파드 · 디플로이먼트 · 서비스 · 인그레스 | 읽기 전용 | 5분 |
| `lab04-helm.sh` | 차트와 값, 환경별 렌더 | 로컬 전용 | 5분 |
| `lab05-terraform.sh` | 코드와 실제 인프라의 차이 계산 | plan 전용 | 6분 |
| `lab06-ansible.sh` | 서버 내부 설정 맞추기 | `--check` 전용 | 4분 |
| `lab07-argocd-gitops.sh` | 깃이 곧 클러스터의 상태 | 읽기 전용 | 4분 |
| `lab08-deploy-and-rollback.sh` | 배포 경로와 롤백 3층 | 읽기 전용 | 5분 |
| `lab09-incident-drill.sh` | 장애 진단 순서 | 읽기 전용 | 6분 |

순서대로 하는 것을 전제로 쓰였다. 뒤쪽 랩은 앞쪽에서 나온 용어를 설명 없이 쓴다.

## 실행

```bash
bash docs/labs/lab01-server-and-ssh.sh
```

한 번에 이어서 보고 싶으면:

```bash
for i in 01 02 03 04 05 06 07 08 09; do
  bash docs/labs/lab${i}-*.sh 2>&1
  printf '\n─── 계속하려면 Enter ───'; read -r _
done
```

## 안전

**어떤 랩도 인프라를 바꾸지 않는다.** 설계상 그렇다:

- terraform 은 `plan` 까지만 — `apply` 는 어느 랩에도 없다
- ansible 은 `--check` 만 안내 — 실제 실행은 하지 않는다
- kubectl 은 `get` · `describe` · `logs` 만 사용
- helm 은 `template` 만 사용 — `install` · `upgrade` 없음

그래도 실행 전에 스크립트를 읽어 보기를 권한다. 남이 쓴 스크립트를 읽지
않고 돌리는 습관은 이 문서가 가르치려는 것의 반대다.

## 출력에 관한 주의

랩 출력에는 실행 시점의 실제 값이 들어간다 — AWS 계정 번호, 사설 IP,
현재 접속 IP 등. **출력을 그대로 공개된 곳에 붙여 넣지 않는다.**
이 리포지토리는 공개돼 있다.

## 필요한 도구

| 도구 | 필요한 랩 | 설치 |
|---|---|---|
| `curl`, `python3` | 대부분 | macOS 기본 |
| `helm` | 04 | `brew install helm` |
| `terraform` | 05 | `brew install terraform` |
| `ansible` | 06 (선택) | `brew install ansible` |
| AWS 자격증명 | 01·05 | `aws configure` |

없는 도구는 해당 랩이 안내 문구를 내고 건너뛴다.

## 접속이 안 될 때

랩 01 이 실패하면 나머지도 실패한다. 대부분 원인은 방화벽에 등록된 IP 와
현재 IP 가 다른 것이다:

```bash
bash scripts/ops/ssh.sh --update-sg   # 지금 IP 를 허용 목록에 추가
bash scripts/ops/ssh.sh k3s "hostname"
```
