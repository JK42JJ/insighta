# 목요일(11-05) verify 실행 런북

- 결정(James 2026-11-04): **verify 명령은 목요일에 Codespaces 에서 먼저 실행하고, 안 되는 것은 금요일 전에 과제에서 뺀다.**
- 이 런북은 제안이다. 저장소 · 코드스페이스 · 결제 설정은 James 가 한다. 아래 초안 파일(`drafts/`)은 어디에도 적용하지 않았고 **한 번도 실행하지 않았다**.
- 목요일에는 Claude Code 가 필요 없다. 쉘 명령만 돌리므로 코드스페이스에 에이전트 세션을 띄우지 않는다. 자격 증명도 필요 없다.

## 1. 선행 (James, 약 30분)

| # | 작업 | 확인 |
|---|---|---|
| 1 | 비공개 repo `insighta-sprint` 생성 | repo 가 존재 |
| 2 | 이 PR 의 `drafts/devcontainer.json` → `insighta-sprint/.devcontainer/devcontainer.json`, `drafts/post-create.sh` → `.devcontainer/post-create.sh` 로 복사 후 push | — |
| 3 | 결제 수단 등록 + **Codespaces 예산 상한 $20** (Settings → Billing → Budgets) | 예산이 보임 |
| 4 | 설정 → Codespaces 에서 유휴 타임아웃 240분, 자동 삭제 기간 설정 | — |
| 5 | **Ultra 인증 확인**: 설정 > 사용량에 "Current session" 막대가 **없어야** 5시간 한도가 없는 인증 계정이다 | 막대 없음. 있으면 5시간 한도가 적용되므로 알려 줄 것 |
| 6 | `insighta-sprint` 에서 4코어 코드스페이스 생성 | 생성 성공 |

코드스페이스를 `insighta-sprint` 에서 만들면 본 repo 에 쓸 수 있는 토큰이 없다(기본 토큰 범위는 문서에서 확정 못 함 → 금요일 시험 5). 목요일에는 본 repo 로 push 하지 않으므로 위험이 없다.

## 2. 실행 (약 1~2시간)

```bash
git clone https://github.com/JK42JJ/insighta.git /workspaces/work/insighta
cd /workspaces/work/insighta
free -h; nproc; df -h .                                    # 머신 사양 기록
cp /workspaces/insighta-sprint/docs/.../drafts/{verify-commands.tsv,thursday-verify.sh} .   # 경로는 실제 위치에 맞게
# 새 셸을 열어 post-create 가 쓴 LOCAL_DATABASE_URL 이 있는지 확인: echo "${LOCAL_DATABASE_URL:+set}"
bash thursday-verify.sh verify-commands.tsv thursday-results.md
cat thursday-results.md
```

- `CI` 환경변수를 설정하지 않는다(설정하면 Jest 워커 상한 3 이 풀린다).
- 명령당 제한 시간은 30분(`TIMEOUT_S`). 시간이 걸리는 `BASE-1`(npm ci), `BASE-4`(Jest)는 따로 시간과 최대 메모리를 기록한다: `/usr/bin/time -v <명령>`.
- 결과가 기대와 다른 줄은 **BROKEN** 으로 표시된다.

## 3. 판정

| 판정 | 뜻 | 처리 |
|---|---|---|
| OK (green) | 기존 명령이 컨테이너에서 통과 | 그대로 사용 |
| OK (red as expected) | 아직 없는 테스트 · 파일을 가리켜 실패 — 경로와 러너는 맞다 | 그대로 사용 |
| BROKEN (should pass) | 환경 · 명령 문제 | 원인 기록 → 고칠 수 있으면 금요일 전에 고치고, 아니면 그 명령에 의존하는 과제를 뺀다 |
| BROKEN (should fail) | 존재하지 않아야 할 테스트가 통과(파일명 충돌 등) | 테스트 파일명을 바꾼다 |

**과제 제외 규칙**: `tasks.md` 의 verify 가 BROKEN 이고 금요일 오전까지 고칠 수 없으면 그 과제를 `excluded` 로 옮기고 이유를 적는다. 컷 라인 Must 과제가 제외되면 James 에게 즉시 알린다.

## 4. 예상되는 실패와 대안 (미검증 추측)

| 증상 | 대안 |
|---|---|
| `postgresql-<ver>-pgvector` 패키지 없음 | PGDG apt 저장소 추가, 또는 DDL 검증을 pgvector 를 쓰지 않는 최소 fixture 에 적용 |
| `prisma db push` 가 `auth` 스키마 때문에 실패 | `prisma migrate diff --from-empty --to-schema-datamodel --script` 로 SQL 을 만들어 `psql` 적용 |
| Playwright 시스템 라이브러리 설치 실패 | `--with-deps` 없이 chromium 만, 또는 FE 브라우저 검증 과제를 뺀다(R08 때문에 FE 과제 자체를 제외) |
| Jest 가 메모리 부족 | `--maxWorkers=2`, 또는 머신을 8코어로 올려 비교(비용 증가는 James 결정) |
| `npm ci` 의 네이티브 빌드(bcrypt, sharp) 실패 | 빌드 도구 패키지 추가 |

## 5. 목요일 산출물

1. `thursday-results.md` (표)
2. 머신 사양, 최대 메모리 · 소요 시간 기록
3. 제외된 과제 목록과 사유
4. 수정이 필요한 `tasks.md` verify 목록 → 문서 PR
5. 금요일 시험 운전을 진행해도 되는지 판단 한 줄

## 6. 이 런북이 확인하지 못한 것

초안 스크립트 · tsv 의 동작(미실행). `LOCAL_DATABASE_URL` 이 새 셸에 로드되는지. 유휴 타임아웃과 12시간 수명(라이브 페이지). 4코어 머신의 RAM(기억으로는 16GB, 미검증).
