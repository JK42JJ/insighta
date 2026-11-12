---
id: WO-2026-11-04-issue-template-request
status: running
owner: insighta-session
opened: 2026-11-04
---

# 목표
요건을 GitHub 이슈 하나로 받는 입구(이슈 폼)를 만든다. 대화는 Slack, 요건의 원본은 이슈.

# 맥락
- 결정: James 2026-11-04 (PRD v1.2 §9 "요건 접수", PR #1767).
- 기존 템플릿 `bug_report.md` · `feature_request.md` 는 그대로 둔다.

# 제약
- 템플릿 파일 1개와 라벨 1개(`request`)만. 워크플로 · 자동화 · 라벨 `approved` 등은 만들지 않는다.
- 항목: 제목, 왜, 원하는 결과, 하지 말 것, 크기(작음/큼), 급함. 기본 라벨 `request`.
- 머지는 James.

# 검증 기준
- [ ] `python3 -c "import yaml; ..."` → 이슈 폼 구조(name · description · body, id 중복 없음, 드롭다운 옵션)가 유효
- [ ] `gh label list` → `request` 라벨 존재(없으면 폼의 기본 라벨이 적용되지 않는다)
- [ ] `git diff origin/main --stat` → `.github/ISSUE_TEMPLATE/request.yml` · 이 오더만
- [ ] 머지 후: `https://github.com/JK42JJ/insighta/issues/new/choose` 에 "Request" 가 보이고 폼이 열린다 (머지 전 확인 불가)

# james
- 머지.
- 머지 후 폼이 열리는지 한 번 확인.

# restated
요건 하나를 이슈 폼으로 받고 `request` 라벨을 자동으로 붙인다. 작업 시작 조건(`approved` 라벨 등)은 PRD v1.2 §9 에 있고 이 PR 은 입구만 만든다.

# 결과
2026-11-04 실측:
- 이슈 폼 구조 검증 통과(필드 id: why, outcome, dont, size, urgency).
- `request` 라벨을 만들고 존재를 확인했다.
- 미검증: GitHub 의 폼 렌더링(머지 전에는 열어 볼 수 없다), 한글 라벨 표시.
- 롤백: PR 닫기 또는 revert, 라벨은 `gh label delete request`.
