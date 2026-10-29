# stg 환경 (stg.insighta.one)

작성 2026-10-29. 근거 오더: `docs/work-orders/WO-2026-10-29-staging-environment.md`. 이 문서의 수치와 사례는 모두 그날 실측이다.

## 목적과 요건

- 목적: main 에 반영한 코드가 배포 후에 실제로 동작하는지(코드 무결성)를 prod 에 올리기 전에 검증한다.
- 요건 A: prod 는 배포 중에도 사용자가 쓸 수 있어야 한다(무중단).
- 요건 B: stg 는 자유롭게 올리고 내릴 수 있다. prod 반영은 stg 확인 후 James 가 승인한 경우에만 한다(R33).
- 제약: 시장 검증 전 추가 비용 불가(R32). stg DB 는 무료 조직의 별도 Supabase 프로젝트이며, Pro 조직의 추가 프로젝트(월 약 $10)는 쓰지 않는다.

## 구성

| | prod | stg |
|---|---|---|
| 서버 | k3s 노드 1대, namespace `insighta-prod` | 같은 노드, namespace `insighta-staging` (우선순위 -200, 메모리 쿼터 requests 384Mi / limits 960Mi) |
| DB | Supabase Pro 조직 `Insighta` | Supabase 무료 조직 `James` 의 프로젝트 `insighta-stg` (500MB) |
| 주소 | insighta.one | stg.insighta.one |
| 규모 | api 2 · frontend 3 · worker 1 | api 1 · frontend 1 · redis 1 · worker 0 |
| api 교체 방식 | RollingUpdate (무중단) | Recreate (교체 중 약 30초 응답 없음, 쿼터 때문) |
| 이미지 반영 | `charts/insighta/environments/prod.yaml` 핀 PR 머지 | 브랜치 `deploy/staging` 을 CI 가 직접 기록 |
| ArgoCD 앱 | `insighta-prod` (자동 동기화) | `insighta-staging` (자동 동기화, 소스 1개) |

namespace 는 이름·Secret·쿼터를 나눌 뿐이다. 노드(CPU·메모리·디스크), ingress, ArgoCD, cert-manager 는 prod 와 공유한다.

## 배포 흐름

현재:

1. main 머지 → `deploy.yml` 의 `scope` 가 변경 경로로 배포 대상 여부를 판정한다.
2. 배포 대상이면 이미지를 빌드하고 stg 잡(스키마 · Edge Function · `deploy/staging` 기록 · 스모크 · E2E)이 돈다.
3. **같은 실행에서 prod 스키마 동기화와 prod Edge Function 배포도 돈다.** prod 이미지는 핀 PR 을 머지해야 반영된다.

따라서 요건 B 는 아직 충족되지 않는다. prod 스키마와 Edge Function 이 승인 전에 적용된다. 해소 = `promote.yml` (승인 게이트, 예정). 그때까지 배포 대상 변경의 머지는 prod 스키마를 즉시 바꾼다.

stg 만 배포: Actions → Deploy → Run workflow → `staging_only` 체크. prod 스키마 · prod Edge Function · prod 핀 PR · prod 용 frontend 빌드를 건너뛴다. 이 경로에서도 api · redis 이미지의 `latest` 태그는 갱신되며, prod 는 sha 고정 태그를 쓰므로 영향이 없다.

## 의도적 차이 (stg ≠ prod)

최신 목록은 `bash scripts/ops/apply-stg-secret.sh --diff` 로 생성한다. 요약:

| 항목 | stg | 이유 | 검증 불가가 되는 것 |
|---|---|---|---|
| LLM · 임베딩 유료 API (OpenRouter · Gemini · Cohere) | 키 없음 | R01, R32 | 목표 문장 → AI 구조 생성(위저드), 챗봇, 요약. 임베딩이 없어 카드 순위가 단어 기반으로 내려감 |
| YouTube | 검색 키 1개 (prod 8번 키) | 무료 쿼터를 prod 와 공유하므로 1개로 제한 | 없음 (수집은 동작) |
| `V5_QUERY_GEN` | `rule` (prod `llm`) | 쿼리 생성에 유료 API 불필요 | LLM 쿼리의 품질 |
| `LIVE_SEARCH_GC_GATE` | `off` (prod `shadow`) | 비동기 Haiku 점수 게이트에 키 없음 | 게이트 trace |
| 메일 · 정기 작업 플래그 7개 | `false` (prod `true`) | R02, 키 없는 API 호출 방지 | 메일 발송, 정기 수집 · 감사 |
| 결제 (LemonSqueezy) | 없음 | 운영 키는 실결제 | 결제 흐름 |
| 슬랙 알림 · 자막(맥미니) · Naver | 없음 | 알림 혼선, 프록시 대역폭 공유 | 해당 기능 |
| Google 로그인 | prod 와 같은 OAuth 클라이언트 | Google 콘솔에 stg 콜백 등록 필요 (아래 남은 일) | 등록 전까지 이메일 로그인만 |
| 데이터 | 비어 있음 + 참조 데이터 14개 테이블 복사 | 무료 500MB (prod 2.4GB) | 영상 풀 기반 추천 |
| worker · keel | 0 · 끔 | 메모리 쿼터, 정기 작업 차단 | 큐 작업 (`PIPELINE_DURABLE_ENABLED=false` 라 파이프라인은 api 안에서 실행) |

## 검증된 것 (2026-10-29 실측)

| 단계 | 결과 |
|---|---|
| 이메일 로그인 → 인증된 API | 성공. 실제 브라우저 E2E 4건 통과 |
| 만다라 저장 (제목 + 하위 목표 8개, LLM 없음) | `POST /api/v1/mandalas/create-with-data` 200 |
| 저장 직후 자동 카드 수집 | 추천 92건, 8칸에 12·12·12·12·12·11·12·9 |
| "카드 추가" 버튼 경로 | `POST /api/v1/mandalas/:id/add-cards` 200, 3초, 60건 (전부 `realtime`) |
| 빈 만다라 (`/create`) | 201. 하위 목표가 없어 파이프라인은 "not enabled" 로 종료 — 카드 수집을 보려면 하위 목표가 있어야 한다 |

화면에서 클릭으로 만다라를 만드는 과정은 API 수준에서만 확인했다.

## 절차

- 계정: `~/.insighta/stg-supabase.env` (credentials.md L14). 테스트 계정 `stg-tester@insighta.one`, James 계정 `jkim0420@gmail.com`. 값은 파일에서 읽고 출력하지 않는다. 가입은 닫혀 있다.
- 만다라 · 카드 수집을 API 로 시험: 로그인 토큰 발급(`POST $STG_SUPABASE_URL/auth/v1/token?grant_type=password`) → `POST /api/v1/mandalas/create-with-data` (`title`, `centerGoal`, `subjects` 8개) → 1~2분 뒤 `GET /api/v1/mandalas/:id/recommendations`. 비관리자는 하루 만다라 5개 한도(429 `DAILY_LIMIT_REACHED`).
- 자동 검증: `e2e-staging.yml` (배포 후 자동, 수동 실행 가능). 실제 브라우저로 로그인한다.
- 테스트 데이터 정리: `stg-clean.yml` 또는 `scripts/ops/clean-stg-data.sh`. 남길 테이블은 `scripts/ops/stg-keep-tables.txt` (사유 필수), 목록에 없는 테이블은 비운다. 이어서 `sync-stg-reference.sh` 가 참조 데이터를 prod 에서 갱신한다 (`stg-reference-tables.txt`, 읽기 전용).
- 구조 복구(파괴적): `dump-prod-schema.sh` 로 prod 구조를 받고 `rebuild-stg-db.sh` 로 적용한 뒤 `scripts/apply-custom-sql.sh`. 리포의 마이그레이션만으로는 빈 DB 를 재구성할 수 없다.
- stg env Secret: `scripts/ops/apply-stg-secret.sh --diff | --apply`. 이미 있는 난수 값은 유지하고, 변경이 있을 때만 api 를 재시작한다.
- ArgoCD 화면: `bash <main 기반 체크아웃>/scripts/ops/argocd-ui.sh` → https://localhost:8080. 구 브랜치 체크아웃에는 파일이 없다.

## 함정 (실측 사례)

| 증상 | 원인 | 조치 · 가드 |
|---|---|---|
| ArgoCD 앱이 렌더되지 않음 | 한 Application 에서 같은 리포의 두 revision 을 읽을 수 없음 (`cannot reference a different revision of the same repository`) | 소스 1개, `deploy/staging` 을 CI 가 재구성 |
| `Recreate` 로 바꾼 동기화 거부 | RollingUpdate 로 만든 Deployment 에 서버가 채운 `rollingUpdate` 블록이 남음. `rollingUpdate: null` 은 server-side apply 에서 무시됨 | 이미 있는 환경은 1회 수동 패치. 새로 만드는 환경은 차트만으로 정상 |
| 쿼터에 막힌 pod 가 쿼터를 비워도 안 생김 | ReplicaSet 재시도 간격이 8분 → 52분으로 늘어남 | `kubectl -n insighta-staging scale deploy insighta-api --replicas=0` 후 `--replicas=1` |
| 스모크 점검이 건너뛰어짐 | 상위 잡이 skipped 면 `if` 에 상태 함수가 없는 하위 잡도 skipped | `always() && …` |
| 이미지가 없는 태그가 stg 에 기록될 뻔함 | `scope.api` 는 frontend/ 밖 변경이면 true, 차트만 바뀌어 빌드가 없어도 | `deployable` 이 아니면 이미지 플래그를 false 로 강제 (`flags` 단계) |
| E2E 파일 변경이 prod 파이프라인을 작동시킬 뻔함 | `frontend/tests/**` · `frontend/playwright*.ts` 가 배포 대상으로 판정 | `IRRELEVANT` 규칙에 추가 + 테스트로 고정. PR 의 파일 목록으로 규칙을 평가했을 때 발견 |
| E2E 가 시작도 못 함: `Playwright does not support chromium on ubuntu26.04-x64` | `ubuntu-latest` 가 26.04 로 이동 | Playwright 를 설치하는 모든 잡을 `ubuntu-24.04` 로 고정 + 테스트 |
| stg Edge Function 배포 실패: `Data limit exceeded` | docker 번들링이 받는 이미지 레지스트리의 한도 | `--use-api` (stg 잡만 적용. prod 잡은 같은 위험에 노출) |
| 만다라 생성이 외래키 오류 | 구조만 복제한 DB 에 `ontology.object_types` (prod 20행) 가 없음 | `sync-stg-reference.sh`. 새 환경은 "쓰기 1건"(만다라 생성)으로 확인한 뒤 동작한다고 선언 |
| 행 수 판단이 틀림 (`object_types` 3 vs 실제 20) | `pg_stat_user_tables.n_live_tup` 은 오래된 추정치 | 판단에는 `count(*)` |
| `DELETE FROM storage.buckets` 실패 | Supabase 가 storage 테이블의 직접 삭제를 막음 | Storage API 사용. 정리 스크립트는 객체 잔여 수만 경고 |
| `newsletter_settings` 를 참조 데이터로 분류 | 이름만 보고 판단. 컬럼에 `user_id` (사용자별 구독) | 분류는 컬럼으로. 사용자 소유 테이블은 비움 |
| Google 버튼에서 `Unsupported provider: provider is not enabled` | stg Supabase 의 Google 이 꺼져 있었음 | 켬. 이어서 `redirect_uri_mismatch` = Google 콘솔에 stg 콜백 미등록 |
| 로컬 확인이 CI 와 다르게 나옴 | macOS BSD `grep` 은 여러 줄 `-qv` 가 GNU 와 다름. zsh 에서 변수 `path` 는 `PATH` 와 연결됨 | CI 셸 판정은 리눅스 컨테이너(GNU)에서 평가. 반복 변수 이름에 `path` 를 쓰지 않음 |
| `gh pr edit` 실패 (Projects classic GraphQL 오류) | GitHub 의 폐지 예고 | `gh api -X PATCH repos/JK42JJ/insighta/pulls/N -F body=@파일` |
| 무거운 로컬 명령이 차단됨 | 메모리 압력 2 이상에서 `memory-guard.sh` 가 차단 (명령 본문의 키워드도 오탐 가능) | `sysctl kern.memorystatus_vm_pressure_level` 이 1 일 때 실행. 우회하지 않음 |
| credentials.md 에 쓴 행이 사라짐 | 쓴 뒤 재확인하지 않음 | 기록 직후 `grep` 으로 확인 |

## 남은 일 · 결정 대기

- `promote.yml` (승인 게이트): R33 의 집행 장치. 성공 직후 `stg-clean.yml` 호출까지 연결.
- Google 콘솔: 운영 OAuth 클라이언트(ID 가 `…aavnr.apps.googleusercontent.com` 으로 끝남)의 승인된 리디렉션 URI 에 `https://ekflpwzjnjllizkhsedz.supabase.co/auth/v1/callback` 추가 (James).
- 임베딩: 맥미니 Ollama 연결(무료)은 클러스터에서의 도달성을 아직 확인하지 않았다.
- 영상 풀 데이터: 무료 500MB 안에서 어느 만큼 둘지 (James).
- `insighta-dev` ArgoCD 앱: 클러스터에 남은 정의(OutOfSync/Missing). dev 는 맥북이며 이 앱은 쓰이지 않는다.
- 노드 가용 메모리: stg 추가 전 561MB → 실측 354~411MB. 300MB 미만이 지속되면 stg 를 0 으로 내린다.
