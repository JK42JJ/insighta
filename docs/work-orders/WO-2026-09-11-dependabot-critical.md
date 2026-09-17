---
id: WO-2026-09-11-dependabot-critical
status: running
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
npm audit 기준으로 critical/high 를 줄인다. 먼저 semver-major 가 아닌 수정을 lockfile 에만 적용해 CI 가 검증하게 하고, major 가 필요한 직접 의존성은 표면별 별도 PR 로 나눈다. 프론트엔드는 `/verify` 가 필요하므로 별도.

# 결과
2026-09-11 (자율 루프 2차) — 1차: 백엔드 non-breaking
- 실측(before): 백엔드 critical 4 · high 26 · moderate 25 · low 11. 프론트엔드 critical 2 · high 16 · moderate 34.
- `npm audit fix --package-lock-only`(major 제외) → 백엔드 critical 1 · high 13 · moderate 20. lockfile 620+/562−.
- 남은 직접 의존성 high 는 전부 major 업그레이드 필요: fastify 4→5.12.4, sharp →0.35.4, nodemailer 9→10, @typescript-eslint 6→8(dev). 각각 별도 오더(표면별 PR, 테스트 동반).
- 프론트엔드(vite · postcss · vitest · happy-dom)는 `/verify` 브라우저 검증이 필요해 다음 오더.
- 검증: CI(`npm ci` + 테스트 + 빌드)가 lockfile 변경을 검증. Keel `supply-chain` 이 머지 후 npm audit 수치 변화를 원장에 남김(#1638 이후).
