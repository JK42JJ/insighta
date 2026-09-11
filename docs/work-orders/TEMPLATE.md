---
id: WO-YYYY-MM-DD-slug
status: draft            # draft | open | running | verified | closed
owner: insighta-session  # insighta-session | career-session | james
opened: YYYY-MM-DD
---

# 목표
한 문장. 사용자 또는 운영자가 얻는 결과로 쓴다. 기능 이름이 아니라 결과.

# 맥락
읽어야 할 것만. 스펙 절 · 설계 문서 · 관련 파일 경로. 세 줄 안.

# 제약
바꾸면 안 되는 것 · 쓰면 안 되는 것 · 비용 상한 · 접근 금지 파일.

# 검증 기준
실행할 수 있는 명령이나 조회와 기대값. 한 줄에 하나. 사람 눈 대신 기계가 읽을 수 있게.
- [ ] 예: `aws iam get-credential-report` → 활성 액세스 키 = admin 1개
- [ ] 예: `gh run list --workflow=keel.yml --limit 1` → conclusion=success

# james
되돌릴 수 없는 결정만. 없으면 "없음".

# restated
(에이전트가 시작 전에 채운다) 검증 기준을 내 말로:

# 결과
(에이전트가 끝에 채운다) 검증 기준 각 줄의 실측 · PR 번호 · 미검증 항목 · 롤백 방법.
