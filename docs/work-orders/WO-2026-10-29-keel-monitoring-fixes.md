---
id: WO-2026-10-29-keel-monitoring-fixes
status: running
owner: insighta-session
opened: 2026-10-29
---

# 목표

Keel 에서 실패로 보이던 항목의 원인을 제거하고, 같은 종류의 정지가 26일 동안 알림 없이 이어지지 않게 한다.

# 맥락

2026-10-29 실측.

- 서비스 가용 현황 TIMEOUT 3건 (자막 수집 · 만다라 임베딩 · 노트 figure) = 맥미니 Tailscale 노드 키가 2026-10-03 에 만료. 같은 날 James 가 맥미니·Azure VM 의 key expiry 를 해제했고, k3s 노드에서 세 포트(4242 · 11434 · 8077) TCP 도달을 확인.
- 맥미니 요약 배치(`com.insighta.daily-targeted`, 매시 KST 22~06시)는 `claude` CLI 로그아웃으로 후보 70건 중 `pass=0` 이었는데 종료코드 0 이라 launchd 에 성공으로 보였다. James 가 재로그인(`loggedIn: true` 확인). 첫 검증 실행 = 2026-10-29 22:00 KST.
- `alert-dispatch` · `cloud-posture` · `iam-hygiene` 는 James 의 콘솔 작업 대기(슬랙 웹훅 · SNS 구독 · admin MFA).
- `supply-chain`: backend critical 4 · high 19, frontend critical 6 · high 14 (`npm audit`).

# 제약

- 맥미니 배치 스크립트(`~/code/insighta/mac-mini/v2-author/*.sh`)는 이 리포의 추적 대상이 아니다. 맥미니의 체크아웃은 2026-05-07 커밋에 수정본이 얹힌 상태다. 그 파일 수정은 James 가 맥미니 변경을 승인한 뒤에만.
- 의존성 업그레이드는 major 변경(`zod` 3→4 등)을 한 PR 에 섞지 않는다.
- 기존 패널의 쿼리·임계값은 유지한다(1단계는 `gridPos.y` 만 변경). 재설계(1a)에서 바뀌는 것은 `서비스 가용 현황` 쿼리(열 추가)와 `마지막 실행` → `마지막 실행 후 경과` 뿐이다. 자원 대시보드는 변경하지 않는다.

# 순서

1. 서비스 가용 현황 패널을 대시보드 최상단으로 이동 (`charts/insighta/dashboards/invariants.json`, y 값만) + 배치 겹침 테스트.
1a. 대시보드 재설계(James 승인 2026-10-30): 4단계 행 구성 — 서비스 정상여부 → 장애 대응 → 비용 → 성능, 이어서 참고. 신규 패널: 불가 서비스 수 · 서비스 가용 이력(서비스별 타임라인, `service-reachability` 원장 15분 간격) · 지금 실패 중인 검사(담당·다음 행동). 서비스 가용 현황에 불가 시 영향 · 현재 상태 시작 · 먼저 볼 곳 열 추가. 성능 패널 7개는 자원 대시보드에서 복사(자원 대시보드 무변경).
2. `supply-chain`: `npm audit` 의 critical 항목부터 비 major 업그레이드(`fixAvailable: true`) → 재감사 → 빌드·테스트.
3. 맥미니 요약 배치: 성공 0건이면 0 이 아닌 종료코드. 맥미니 파일 수정이라 James 승인 후.
4. 22:00 KST 정기 실행 결과(`pass=N`) 확인으로 요약 복구 판정.

# 검증 기준

- [ ] 대시보드: 행 순서 서비스 정상여부 → 장애 대응 → 비용 → 성능, 가용 현황·가용 이력이 첫 행 안, 패널 id 중복·겹침 0 (`tests/unit/keel/dashboard-layout.test.ts`)
- [ ] 새 SQL 5개를 실제 원장에서 실행해 결과 확인 (2026-10-30 완료: 가용 9행, 이력 24,210행/30일, 실패 검사 5행)
- [ ] 배포 후 `https://insighta.one/keel/` 에서 첫 행이 서비스 정상여부이고 이력 그래프에 09-08~09-15 · 10-03~10-29 불가 구간이 보임 (로그인 화면 캡처)
- [ ] supply-chain: critical 0, 그 외 변경은 high 감소분만
- [ ] 2026-10-29 22:00 KST 배치: `candidates=70 pass>0`

# 롤백

- 대시보드: 커밋 revert (y 값만 변경).
- 의존성: 각 PR revert, 락파일 복원.
