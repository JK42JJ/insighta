---
id: WO-2026-10-29-staging-environment
status: running
owner: insighta-session
opened: 2026-10-29
---

# 목표

코드 변경이 prod 에 닿기 전에 stg(stg.insighta.one)에서 먼저 배포·검증되고, prod 반영은 James 가 실행하는 promote 한 경로로만 일어난다.

# 맥락

- 현행(2026-10-29 실측): main 머지 시 `deploy.yml` 이 prod DB 스키마(`migrate`)와 Edge Function 을 **즉시** 바꾸고, 이미지 버전은 `prod.yaml` 핀 PR 머지 후 ArgoCD `insighta-prod` 가 반영.
- 클러스터: k3s 노드 1대(메모리 3,836MB, 가용 약 620MB). ArgoCD 앱 `insighta-staging` 은 정의만 있고 namespace·pod 없음(OutOfSync/Missing). root 앱 없음 → `charts/bootstrap/` 은 수동 apply.
- James 결정(2026-10-29): 추가 비용 0 — 노드 추가 없이 같은 노드에서 namespace 분리. DB = Supabase 무료 조직 `James` 에 별도 프로젝트 `insighta-stg`. SmartBuy 는 생성 전 백업(외장 드라이브 `/Volumes/storage/backups/smartbuy-2026-10-29/`).

# 제약

- prod 렌더 무변경: `helm template` prod·dev·validation 출력이 PR 전후 0줄 차이.
- stg 는 prod 를 해치지 않는다: PriorityClass `insighta-staging`(-200, preemption 없음) · namespace ResourceQuota(requests 384Mi / limits 960Mi) · 작은 requests.
- stg Secret 에 LLM(OpenRouter·Gemini·Cohere·ElevenLabs·RunPod)·YouTube·결제·자막·Slack·메일 키를 넣지 않는다. `TRANSACTIONAL_EMAIL_ENABLED=false`. (CLAUDE.md LLM API 금지 · 메일 발송 James 권한)
- ECR 레지스트리 호스트(AWS 계정 id)는 커밋하지 않는다 — 공개 리포.
- prod 배포 경로 전환(PR-3)은 stg 가 리허설 1회를 통과한 뒤에만.

# 순서

1. PR-1 차트: priorityClassName 옵션 · ResourceQuota 템플릿 · staging.yaml · staging Application 템플릿 + `scripts/ops/apply-staging-app.sh` · PriorityClass.
2. 클러스터 수동: namespace · `insighta-env` Secret(stg) · PriorityClass apply · `deploy/staging` 브랜치(staging-images.yaml) · staging Application apply.
3. DNS `stg` A 레코드(James, GoDaddy) → 인증서 발급.
4. PR-2a(가산): main 머지 시 stg 이미지 빌드(frontend 는 stg Supabase 빌드 인자로 별도 태그 `stg-<sha>`) · stg migrate · stg Edge Function · `deploy/staging` 기록. 기존 prod 경로 유지.
5. stg 첫 배포 확인 + prod 영향 측정.
6. PR-3(전환): prod migrate·Edge Function·핀 PR 을 `promote.yml`(수동) 로 이동. main 머지는 stg 만.
7. 리허설: 무해 변경 1건 머지 → stg → promote → prod.

# 검증 기준

- [ ] PR-1: prod·dev·validation `helm template` 전후 diff 0줄, 객체 수 동일
- [ ] PR-1: staging 렌더가 `kubectl apply --dry-run=server -n insighta-staging` 전부 통과(쿼터 포함)
- [ ] stg pod Ready, `https://stg.insighta.one/health` 200, 테스트 계정 로그인
- [ ] stg 기동 후 prod pod 재시작 0 · 노드 가용 메모리 ≥ 300MB
- [ ] 리허설: stg 반영 → promote → prod 반영, prod 로그인 화면 렌더

# james

- GoDaddy `stg` A 레코드 추가
- PR 머지(PR-1 · PR-2a · PR-3), 리허설 promote 실행

# restated

같은 노드의 별도 namespace 와 별도 무료 Supabase 프로젝트로 stg 를 세우고, main 머지는 stg 까지만 가며, prod 는 stg 에서 검증된 sha 를 promote 로만 받는다.
