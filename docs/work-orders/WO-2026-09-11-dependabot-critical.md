---
id: WO-2026-09-11-dependabot-critical
status: draft
owner: insighta-session
opened: 2026-09-11
---

# 목표
알려진 취약점이 있는 의존성으로 프로덕션이 돌지 않는다. critical 7 → 0, high 103 → 0 (직접 의존성부터).

# 맥락
Dependabot alerts 를 2026-09-11 에 켜자 main 기준 279건(critical 7 · high 103 · moderate 148 · low 21)이 보고됨. https://github.com/JK42JJ/insighta/security/dependabot . `docs/security/control-catalog.md` ICS-SC-02.

# 제약
- 메이저 업그레이드는 표면별로 나눠 PR (같은 파일을 다시 여는 항목은 한 PR).
- 프론트엔드 변경은 `/verify` PASS 필수. 배포 후 SW 캐시 검증.
- 비용 0. 새 유료 스캐너 없음.

# 검증 기준
- [ ] `gh api repos/JK42JJ/insighta/dependabot/alerts?state=open --paginate --jq '.[].security_advisory.severity' | sort | uniq -c` → critical 0, high 0
- [ ] CI 전부 통과, `/verify` PASS
- [ ] Keel `service-reachability` 배포 후 OK

# james
없음. (전이 의존성이라 업그레이드 불가한 항목은 QUESTIONS 에 사유와 함께.)

# restated

# 결과
