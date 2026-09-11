---
id: WO-2026-09-11-newsletter-v21-pr1
status: open
owner: insighta-session
opened: 2026-09-11
---

# 목표
뉴스레터가 매호 같은 품질로 나오도록 하는 기반 = 문장이 근거를 가리키지 않으면 저장조차 안 되는 데이터 모델과, 중단 지점부터 재개되는 실행 골격을 프로덕션 DB 에 둔다.

# 맥락
`~/Downloads/insighta-newsletter-pipeline-implementation-v2.1.md` §3(데이터 모델) · §1(실행 구조) · §9 PR 1. 검토 = 이 세션 2026-09-11. 기존: `prisma/migrations/newsletter/*`, `src/modules/newsletter/`, pg-boss 9 설치됨.

# 제약
- 기존 `newsletter_*` 테이블과 8단계 파이프라인은 건드리지 않는다(창간호 발송 경로).
- LLM 호출 0. 프로덕션 LLM 실행 · 플래그 활성 · 머지는 James 게이트(핸드오프 표지).
- DDL 은 raw SQL 을 `prisma/migrations/newsletter-v2/` 에 함께 둔다(prisma db push silent fail 규칙).
- 비용 0. DBOS 가 풀러(pgbouncer 트랜잭션 모드)에서 안 되면 직접 연결 문자열 대신 pg-boss 대안을 QUESTIONS 에 올린다.

# 검증 기준
- [ ] `psql "$DIRECT_URL" -c "\dt nl_*"` → 테이블 12개(nl_domain · nl_issue · nl_issue_version · nl_signal · nl_evidence · nl_claim · nl_claim_evidence · nl_atomic_claim · nl_atomic_claim_evidence · nl_gate_result · nl_gate_spec · nl_rejection · nl_feedback · nl_eval) + source_creator · channel_identity · collect_job · video_captions
- [ ] `nl_claim` 에 `ctype='fact'` 이고 원자 주장이 없는 행 INSERT → 트리거가 거부
- [ ] `nl_domain` 에 `ai-tech` 행 1개
- [ ] `nl_gate_spec` 에 hard 8 · soft 8 행
- [ ] 빈 `NewsletterIssueWorkflow` 가 로컬에서 시작 → 즉시 완료, 재시작 시 재개 확인
- [ ] 로컬 `prisma db push` 후 `\d nl_claim` 컬럼 전부 존재

# james
- 머지(= prod 스키마 적용). 표지 규칙대로 James 가 프로덕션 DB 에서 테이블을 직접 확인한 뒤 닫는다.
- v2.1 §8 결정 3건(문체 어미 · 등급 어휘 · 논지 편집장)은 PR 4 이후에 필요. 지금은 아님.

# restated

# 결과
