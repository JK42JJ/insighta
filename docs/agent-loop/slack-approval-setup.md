# Slack 승인 채널 설정 체크리스트

- 작성: 2026-11-04 / 근거: PRD v1.2 §8
- 이 문서는 설정 절차만 담는다. Slack 워크스페이스 생성과 GitHub 앱 연결은 James 가 한다.
- **미검증 표기**: GitHub Slack 앱의 명령어 · 기능 이름 · 인플레이스 승인 동작은 GitHub 공개 문서 기준 지식이며 이 세션에서 실행해 확인하지 않았다. 실행 전 `/github subscribe list features` 로 현재 지원 목록을 확인하고, 아래 H 절의 시험으로 동작을 확인한다.

## A. 구조

| 채널 | 들어가는 주체 | 흐르는 것 | 들어가면 안 되는 것 |
|---|---|---|---|
| `#insighta-approvals` (비공개) | James, **GitHub 앱만** | 배포 검토 요청(Production 환경 대기), 승인 · 거절 버튼 | helpdesk 봇, 다른 모든 앱, James 외 사람 |
| `#insighta-agent` | James, helpdesk, Keel 알림, GitHub 앱 | 스크럼, 알림, `risk:human` PR 링크, 실패한 워크플로 | 승인 버튼이 있는 메시지 |

원칙: **승인 주체는 GitHub** (Production 환경 required reviewer = James). Slack 은 알림과 인플레이스 승인 버튼만 제공한다. Slack 이 죽어도 GitHub Actions 화면에서 같은 대기 건을 승인할 수 있다.

## B. 승인 대상과 경로

| 대상 | 경로 | 승인 위치 |
|---|---|---|
| prod 승급 | `promote.yml` dispatch → `Production` 환경 대기 | `#insighta-approvals` 버튼 또는 GitHub |
| terraform apply | 별도 `workflow_dispatch` → 같은 `Production` 환경 대기 (Q15 가 "별도"로 확정될 때) | 위와 동일 |
| 노드 증설 | terraform 변경 PR 머지 → apply dispatch → `Production` 환경 대기 | 위와 동일. 기존 규칙("Slack 승인 요청 후 James 의 명시 승인")의 Slack 요청 단계가 이 알림이다 |
| `risk:human` 과제 | PR 에 라벨 → `#insighta-agent` 에 PR 링크만 | **GitHub PR 리뷰** (Slack 버튼 없음) |

노드 증설은 EC2 인스턴스 변경이므로 코드상 terraform 경로를 탄다는 것은 추측이다(`terraform/projects/insighta/environments/prod` 와 `terraform.yml` 의 인스턴스 타입 드리프트 주석에서 유추). PR-E 설계 시 확인한다.

## C. helpdesk 와 에이전트의 권한 경계

- helpdesk 는 승인 · dispatch 권한과 도구를 갖지 않는다. 도구 목록은 `read_status`, `list_prs`, `append_instruction` 뿐이다(FR-HELP-2).
- helpdesk 는 `#insighta-approvals` 에 초대하지 않는다. 채널 멤버 목록에서 James 와 GitHub 앱 외 항목이 없음을 점검 항목으로 둔다(H-3).
- 에이전트 GitHub App(`insighta-agent`)에는 `actions: write` 와 `administration` 권한을 주지 않는다(FR-GH-4). 따라서 `promote` 를 dispatch 하지 못한다. dispatch 는 James 가 한다.
- 에이전트가 쓴 PR 제목 · 본문은 Slack 알림에 그대로 노출된다. **승인 판단은 Slack 에 보이는 문구가 아니라 GitHub 의 diff 와 gate 결과로 한다.**

## D. James 설정 체크리스트

### D-1 Slack
- [ ] 워크스페이스 생성 (무료 플랜. 유료 전환 금지 — 추가 비용 금지 규칙)
- [ ] 채널 생성: `#insighta-approvals` (**비공개**), `#insighta-agent`
- [ ] 워크스페이스 설정에서 앱 설치 권한을 관리자(James)로 제한
- [ ] `#insighta-approvals` 멤버 = James 한 명

### D-2 GitHub 앱 설치와 연결
- [ ] Slack 앱 디렉터리에서 GitHub 앱 설치 (워크스페이스 관리자 승인)
- [ ] 아무 채널에서 `/github signin` → GitHub 계정(JK42JJ) 연결
- [ ] repo `JK42JJ/insighta` 에 GitHub 앱 접근 허용 (GitHub 설정 → Applications 에서 repo 선택)
- [ ] 비공개 채널에 앱 초대: `/invite @GitHub`

### D-3 구독 명령
`#insighta-approvals` 에서:
```
/github subscribe JK42JJ/insighta deployments
```
`#insighta-agent` 에서:
```
/github subscribe JK42JJ/insighta pulls +label:"risk:human"
/github subscribe JK42JJ/insighta pulls +label:"needs-human"
/github subscribe JK42JJ/insighta workflows
```
- 구독 확인: `/github subscribe list`
- 해제: `/github unsubscribe JK42JJ/insighta`
- 기능 이름 목록 확인: `/github subscribe list features`
- `pulls` 구독에 라벨 필터를 쓰는 문법과 `workflows` 의 필터(이름 · 이벤트 · 브랜치)는 지원 여부를 위 명령으로 확인한다. 지원하지 않으면 `pulls` 전체를 구독하고 노이즈가 크면 해제한다.
- `#insighta-approvals` 에는 `deployments` 외에 구독하지 않는다. 다른 이벤트가 섞이면 승인 요청이 묻힌다.

### D-4 GitHub 설정
- [ ] Settings → Environments → `Production`: **Required reviewers = JK42JJ**
- [ ] 같은 화면의 "Prevent self-review" 는 **끈다** (James 가 dispatch 도 하고 승인도 하는 구조. 켜면 잠긴다)
- [ ] Deployment branches 를 `main` 으로 제한 (선택, Q18 의 환경 이름 정리 후)
- [ ] 환경 이름이 `Production` 인지 `production` 인지 확인 (Q18)
- [ ] 에이전트 GitHub App 을 만들 때 `actions` · `administration` · `workflows` 권한을 주지 않는다

### D-5 알림용 웹훅 (Keel, 별도 경로)
- [ ] Slack 앱 또는 Incoming Webhook 을 `#insighta-agent` 대상으로 생성
- [ ] 값은 James 가 시크릿 저장소에 직접 입력 (GitHub 시크릿 이름 `SLACK_ALERT_WEBHOOK` 은 이미 존재, 클러스터 쪽 이름 · 위치는 `memory/credentials.md` 에서 확인). **값을 채팅 · 커밋 · 로그에 쓰지 않는다.**
- [ ] 이 웹훅은 승인 버튼과 무관하다. GitHub 앱은 `#insighta-approvals` 와 `#insighta-agent` 의 PR · 실행 알림, 웹훅은 Keel 알림용이다.

## E. 승인 흐름 (목표 상태)

1. James 가 `promote.yml` 을 dispatch (`gh workflow run promote.yml -f sha=<sha> -f reason=<text>` 또는 Actions 화면).
2. `gate` 잡이 해당 sha 의 smoke · E2E 성공을 확인. 실패하면 여기서 끝난다 (건너뜀 = 실패).
3. `Production` 환경 대기 → `#insighta-approvals` 에 검토 요청 도착.
4. James 가 GitHub 에서 diff · gate 결과를 본 뒤 Slack 버튼 또는 GitHub 에서 승인 · 거절.
5. 변경 잡 실행. 결과는 `#insighta-agent` 와 Keel 이 확인.

## F. 실패 · 폴백

| 상황 | 대응 |
|---|---|
| Slack 장애 · 알림 누락 | GitHub Actions 화면의 대기 중 실행에서 승인. 시험 H-1 에서 폴백 경로도 확인 |
| 앱 연결 계정이 reviewer 가 아님 | 인플레이스 승인이 거부될 것으로 추정(미검증). H-2 에서 확인 |
| 승인 메시지가 의심스러움 | 승인하지 않는다. GitHub 에서 실행 로그 · diff 확인 후 거절 |

## G. repo 가 private 로 바뀌는 경우의 대안 (한 줄)

private repo 의 Environment required reviewers 는 유료 플랜이 필요하므로(GitHub 문서 기준 지식, 미검증) 추가 비용 금지 규칙에 걸린다. 대안은 **promote 의 승인 = James 만 머지할 수 있는 prod 태그 고정 PR 의 머지**로 옮기고(CODEOWNERS · 룰셋), Slack 은 그 PR 알림만 맡는 것이다.

## H. 시험 (PR-A 스텁 워크플로로, prod 무영향)

변경 잡이 `echo` 스텁인 `promote.yml` 이 main 에 들어간 뒤에만 가능하다(`workflow_dispatch` 는 기본 브랜치에 파일이 있어야 한다).

- [ ] **H-1 승인 경로**: 초록 sha 로 dispatch → `#insighta-approvals` 에 검토 요청이 도착 → Slack 버튼으로 승인 → 스텁 잡이 실행됨
- [ ] **H-1b 폴백**: 한 번 더 dispatch → Slack 을 무시하고 GitHub 화면에서 승인 → 동일하게 진행됨
- [ ] **H-2 거절 경로**: dispatch → Slack 에서 거절 → 스텁 잡이 실행되지 않음
- [ ] **H-3 채널 점검**: `#insighta-approvals` 멤버가 James 와 GitHub 앱뿐임
- [ ] **H-4 권한 경계**: 에이전트 GitHub App 생성 후 `gh api` 로 해당 App 토큰이 `actions: write` 를 갖지 않음을 확인하고 `promote` dispatch 시도가 거부됨 (트랙 B 에서 App 을 만들 때 수행)

시험 결과는 `docs/ops/agent-loop/` 에 날짜와 함께 기록한다.
