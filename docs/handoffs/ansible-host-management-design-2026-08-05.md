# 호스트 관리 — Ansible 구조 설계

> 2026-08-05 · **설계 전용, 구현 금지**
> 인벤토리는 `~/.ssh/config` · `tailscale status` · `cursor/career` 실측. Ansible 은 이미 설치돼 있음 (`/opt/homebrew/bin/ansible`).

## 0. 왜 필요한가 — 오늘 실제로 겪은 것

**사례 1.** 풀 수집이 2026-06-04 에 멈춘 것을 2개월 뒤에 발견했다. 원인을 찾는 데 반나절이
걸렸고, 답은 코드도 DB 도 아닌 **GitHub Actions 워크플로 헤더 주석**에 있었다.

**사례 2.** Mac Mini 가 다운인데 **거기에 무엇이 어떻게 설치돼 있는지 어디에도 없다.**
tmux 세션의 자막 서비스, Ollama, 수집 cron — 재구축 절차가 사람 기억에만 있다.

**사례 3 (오늘, 자기 오판).** Azure VM 의 OCI A1 retry loop 이 "죽어서 6일 방치" 라고
판단했다. 실제로는 **2026-07-30 에 James 가 A1 을 포기하고 E2.1.Micro 로 전환**한 결과였고,
그 결정은 **다른 리포(`cursor/career`)의 문서**에 기록돼 있었다.

세 사례의 공통점: **호스트에 무엇이 있고 왜 그런지를 물어볼 곳이 없다.**
Ansible 이 푸는 것은 배포가 아니라 **호스트 상태의 재현성과 조회 가능성**이다.

## 1. 인벤토리 — 실측, 두 그룹

**두 리포의 호스트를 별도 인벤토리로 분리한다 (James 2026-08-05).**

### insighta 인벤토리

| 호스트 | tailnet IP | 역할 | 상태 |
|---|---|---|---|
| `insighta-prod-ec2` | 100.102.124.23 | prod API·frontend·redis (docker) | 가동 |
| `james-macmini` | 100.91.173.17 | Ollama · 자막 프록시 · 수집 cron | **다운** (08-03 실측) |
| `insighta-azure-vm` | 100.126.212.33 | 상시 tailnet 노드 | 가동 |

### career 인벤토리

| 호스트 | 접근 | 역할 | 상태 |
|---|---|---|---|
| Oracle **E2.1.Micro** | Public IP (tailnet 아님) | `console-api.insighta.one` FastAPI + Caddy | 런북 존재 |

**~~OCI A1 (ARM)~~ 은 폐기됐다** — 2026-07-30, 캐파 부족으로 E2.1.Micro 대체
(`career/app/DEPLOY.md` §스택 근거). insighta 메모리의 "retry loop 가동 중" 기록은 **stale**.

### 왜 분리하는가

- **소유 리포가 다르다.** career 호스트의 런북·시크릿·배포는 `cursor/career` 에 산다
- **접근 경로가 다르다.** insighta 는 tailnet, career Oracle 은 공개 IP + Caddy
- **하드룰이 다르다.** career 는 *"맥미니/Tailscale 서비스 경로 금지"* 를 명시한다 (§3-4 참조)

## 2. tailnet 이 insighta 그룹에서 결정적인 이유

EC2 SSH 는 SG IP 화이트리스트로 막혀 있고, `scripts/ssh-connect.sh` 가 접속 전 SG 를 갱신한다.
직접 `ssh insighta-ec2` 는 hook 이 차단한다 (LEVEL-3, 3회 재발 끝에 기계 강제).

**인벤토리를 tailnet IP 로 쓰면 그 문제가 사라진다.** SG 갱신 불필요, hook 충돌 없음,
공개 IP 노출 없음. 모든 insighta 노드가 이미 tailnet 에 있으므로 **추가 인프라 0**.

```ini
# inventories/insighta.ini
[prod]
insighta-prod-ec2 ansible_host=100.102.124.23 ansible_user=ubuntu

[workers]
james-macmini     ansible_host=100.91.173.17
insighta-azure-vm ansible_host=100.126.212.33 ansible_user=azureuser
```

```ini
# inventories/career.ini
[console]
console-api ansible_host=<public-ip> ansible_user=ubuntu
```

## 3. 경계 — 설계의 핵심

흐리면 소유자가 둘이 된다.

### 3-1. Ansible 이 소유 — 호스트 레벨

| 대상 | 지금 어디에 |
|---|---|
| Mac Mini 자막 서비스 (tmux) | **사람 기억** |
| Mac Mini Ollama 모델·설정 | **사람 기억** |
| Mac Mini 수집 cron | **사람 기억** ← 오늘 확인 불가했던 그것 |
| EC2 호스트 nginx · SSL | 호스트에만 |
| 백업 cron (`pg_dump` → S3) | 호스트에만 |
| tailscale 데몬 상태 | — |
| **career**: Caddy · systemd `console-api` · venv | `app/deploy/bootstrap.sh` ← **이미 스크립트로 존재** |

### 3-2. CI 가 계속 소유 — 앱 레벨

| 대상 | 소유자 |
|---|---|
| 컨테이너 빌드·push | `deploy.yml` → GHCR |
| `docker compose pull && up -d` | `deploy.yml` |
| `/opt/tubearchive/.env` | `deploy.yml` (GitHub Secrets 생성) |
| DB 스키마 | `deploy.yml` migrate |

**Ansible 이 배포를 가져오면 안 된다.** 지금 배포는 작동하고 CI 가 유일 소유자다.
두 시스템이 같은 컨테이너를 만지면 "누가 마지막에 썼나" 를 추적할 수 없다.

### 3-3. 절대 만지지 않는 것

- **`.env` 파일 일체** — CLAUDE.md 절대 규칙(CP358). prod `.env` 는 매 배포마다 CI 가 재작성.
  career 의 `/etc/console-api.env` 도 *"James 가 값 기입"* 으로 런북에 명시돼 있다
- **시크릿 저장** — GitHub Secrets 가 SSOT. Ansible vault 도입은 SSOT 를 둘로 만든다.
  파일의 **존재·권한(600)** 은 관리하되 **내용은 관리하지 않는다**
- **prod 데몬 무단 재시작** — LEVEL-3 하드룰(2026-06-30 tailscaled 사건)

### 3-4. career 하드룰과의 충돌 — 명시적으로 구분

`career/app/DEPLOY.md` 하드룰:

> *"맥미니/Tailscale 서비스 경로 금지 (`macmini-session-dependency` · `tailscale-backup-only-not-service`)"*

**본 설계의 tailnet 사용과 층이 다르다.** 그 룰은 **서비스 트래픽**(사용자 요청이 흐르는 경로)에
대한 것이고, 여기서 tailnet 을 쓰는 것은 **관리 평면**(SSH 접속)이다.

> **Ansible 은 관리 평면이며, 어떤 서비스 트래픽도 tailnet 을 경유하지 않는다.**

이 문장을 설계 원칙으로 못박는다. 같은 판단이 두 리포에 반대로 있으면 안 된다.

## 4. 구조

```
ansible/                          ← 별도 리포 권장 (§8-C)
  inventories/
    insighta.ini                  tailnet IP
    career.ini                    public IP
  group_vars/
    all.yml                       비밀 아님: 포트·경로·모델명
  playbooks/
    check.yml                     ★ 기본. READ-ONLY 드리프트 보고
    macmini.yml                   Ollama · 자막서비스 · cron
    azure.yml                     tailscale · 상시 노드
    prod-host.yml                 nginx · certbot · 백업 cron  (컨테이너 제외)
    console-api.yml               career: Caddy · systemd · venv
  roles/
    common/                       tailscale 상태 · 시간대 · 기본 패키지
    ollama/
    transcript-proxy/             tmux → launchd 승격 (§8-B)
    collector-cron/               "왜 멈췄나" 의 답이 여기 살아야
    console-api/                  bootstrap.sh 를 롤로 이식
```

### 4-1. `check.yml` 이 기본이어야 하는 이유

**변경보다 조회가 먼저 필요하다.** 오늘의 실제 질문은 "고쳐줘" 가 아니라
**"수집 cron 이 지금 걸려 있나?"** 였고, 그 답에 반나절이 걸렸다.

`--check` 로만 돌고 아무것도 바꾸지 않는다. 출력은 드리프트 목록:

```
james-macmini      ollama          RUNNING   qwen3-embedding:8b 있음
james-macmini      transcript-svc  DOWN      tmux 세션 없음
james-macmini      collector-cron  ABSENT    크론 항목 없음
insighta-prod-ec2  nginx           RUNNING
insighta-prod-ec2  backup-cron     PRESENT   03:00 UTC
console-api        caddy           RUNNING   cert 만료 D-58
console-api        console-api     RUNNING   uvicorn 127.0.0.1:8600
```

**이 표가 있었으면 오늘 수집 정지 원인을 30초에 알았다.**
그리고 A1 retry 건도 — 상태가 `ABSENT` 로 보였을 뿐 "사고" 로 오판하지 않았을 것이다.
(다만 *왜* 없는지는 여전히 문서의 몫이다. §7 참조)

### 4-2. 변경은 명시 태그

```
ansible-playbook playbooks/macmini.yml --tags restart --limit james-macmini
```

태그 없이 실행하면 **설치·설정만 수렴**하고 데몬은 안 건드린다.
재시작은 항상 명시적 — LEVEL-3 룰의 기계적 표현이다.

## 5. 착수 순서

1. **`check.yml` 만 먼저.** 변경 롤 없이 조회부터. **접속 검증 + 현 상태 스냅샷**이 산출물
2. **Azure VM** — 지금 접속되고, prod 아니고, 역할이 단순하다. 첫 수렴 대상으로 안전
3. **career console-api** — `bootstrap.sh` 가 이미 있어 롤 이식이 기계적. 런북이 명세 역할
4. **Mac Mini** — **복구가 선행** (James 물리 확인 대기). 복구하면서 만들면 절차가 그대로 코드가 된다
5. **prod EC2** — **가장 마지막.** 잘 도는 것을 먼저 건드릴 이유가 없다

## 6. 하지 않는 것 — 명시

- **Terraform 대체 안 함.** Terraform = 인프라 프로비저닝(VPC·SG·EC2 생성),
  Ansible = 그 위 호스트 상태. 층이 다르고 이미 `terraform/` 가 있다
- **컨테이너 오케스트레이션 안 함.** compose + CI 로 충분
- **AWX/Tower 안 함.** 노드 4개에 관리 서버는 과하다
- **CI 자동 실행 안 함** (초기). 사람이 명시적으로 돌린다. `check.yml` 이 안정된 뒤 검토

## 7. 이 설계가 풀지 못하는 것 — 정직하게

**"왜 이 상태인가" 는 Ansible 이 답하지 못한다.**

오늘 A1 retry 오판이 그 증거다. `check.yml` 이 `ABSENT` 를 보여줬어도, 그것이
**의도된 폐기**인지 **사고**인지는 구분 못 한다. 그 답은 `career/app/DEPLOY.md` 의 한 줄에
있었다.

**상태는 Ansible, 이유는 문서·원장.** 오늘 만든 T/C/P 원장이 그 이유를 담는 자리이고,
Ansible 은 그것과 짝을 이룰 때만 완결된다.

## 8. 미측정 / 열린 결정

| # | 항목 |
|---|---|
| A | Mac Mini 다운이라 **현재 설치 상태를 읽을 수 없다.** 복구 선행 |
| B | 자막 서비스를 tmux → launchd 승격할지. tmux 는 재부팅에 안 살아남는다 |
| C | `ansible/` 위치 — **두 리포 호스트를 함께 다루므로 별도 리포가 자연스럽다.** 시크릿을 안 담으므로 공개 여부는 별도 판단 |
| D | Oracle E2.1.Micro 의 **Public IP 실측 필요** (`~/.ssh/config` 에 별칭 없음) |
| E | macbookpro(로컬)를 인벤토리에 넣을지. 개발 환경 재현엔 유용하나 범위가 커진다 |
| F | 공수 — **미산정** |

## 9. 이 문서가 주장하지 않는 것

- Ansible 이 지금 문제를 즉시 해결한다 — Mac Mini 가 살아나야 그쪽은 시작할 수 있다
- 배포가 개선된다 — 배포는 CI 소유이고 이 설계는 손대지 않는다
- career 쪽 런북을 대체한다 — `DEPLOY.md` 가 명세이고 Ansible 은 그 집행자다
