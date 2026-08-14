# 2026-07-14 — 베타 초대·노트완성 이메일이 실제로 발송됩니다

> **세션 별칭: `베타-이메일-E2E`**

## 한눈에 보기

admin에서 베타 신청자를 "초대 처리"하면 이제 **베타 초대 이메일이 실제로 발송**됩니다. 노트(10분만에 보는 책)가 처음 완성되면 **노트완성 이메일**이 소유자에게 도착하고, "노트 읽어보기" 버튼은 해당 만다라의 **노트 모드로 직행**합니다.

## 사용자 관점 변경점

- **베타 신청자**: 초대 확정 시 이메일 수신 — 참여 안내 + 신청한 이메일로 로그인하라는 가입 유도 + 온보딩 3걸음 + 본인이 적은 학습 목표 에코.
- **노트 완성 알림**: 만다라의 책이 처음 완성되는 순간 1회 발송 (재충전마다 반복 발송되지 않음 — 완성 배리어와 결합).
- **이메일 링크 신뢰성**: 링크가 항상 최신 앱 코드로 열립니다 (이전에는 앱을 쓰던 기기에서 배포 직전 버전으로 열리는 창이 존재).

## 왜 바꿨나 (측정 근거)

- 초대 처리 클릭이 prod에서 3회 연속 400 (`FST_ERR_CTP_EMPTY_JSON_BODY` 로그 실측) — 상태 변경 자체가 불가능했음.
- 이메일 CTA가 라우터에 없는 1-세그먼트 URL(`/learning/:mandalaId`)을 발송 → 클릭 = 404 (오너 실클릭으로 발각).
- CTA 영상 픽이 학습 페이지의 실데이터 소스(`user_video_states ∪ user_local_cards`)와 불일치 — 오너 계정 실측으로 ulc placed 0 확인 후 교정.
- PWA 스테일 서비스워커가 배포 전 번들을 서빙 → `?view=note` 무시 (하드리로드 탭에서만 정상이던 것을 실기기 클릭이 반증).

## 알려진 한계 · 백로그

- api-client의 body-less 요청 근본 수정(chokepoint)은 Issue #1228로 등록 (동일 클래스 3번째: #935/#860/이번).
- 타 계정 만다라 URL 진입 시 빈 학습 화면(가드 없음) — 백로그 후보.
- 카카오톡 공유 이미지(/mobile OG)는 별도 트랙.

---

## 기술 상세

| PR | 내용 |
|----|------|
| #1210 | fix(admin): mark-invited 400 — `markBetaInvited` body `{}` + regression guard |
| #1211 | feat(email+book): CP516 패키지 리베이스 머지 — templates/transactional + book-fill 완성배리어 (flag off) |
| #1212 | fix(email): note CTA 2-seg 라우트 + `note-ready-cta.ts` 헬퍼 + 대시보드 폴백 |
| #1214 | feat(email): 가입-전 베타 초대 전용 템플릿(`buildBetaInviteEmail`) + LearningPage `?view=note` 딥링크 + 픽 소스 v1 |
| #1216 | fix(email): 픽 = uvs∪ulc (페이지 실소스, youtube_videos join) + supabase CLI 2.109.1 핀 (EF deploy rate-limit 3연속 종결) |
| #1219 | fix(pwa): /learning 하드 네비게이션 SW app-shell 폴백 우회 (스테일 번들 클래스 영구 차단) |
| #1222 | feat(email): flag-on — `TRANSACTIONAL_EMAIL_ENABLED` + `BOOK_FILL_BARRIER_ENABLED` (compose 2줄) |

- **발송 인프라**: Gmail SMTP Relay (EC2 IP 인증, `smtp-relay.gmail.com:587` 코드 기본값) — 신규 시크릿 0.
- **검증 사슬**: prod 로그 실측(400/발송) → 브라우저 E2E(세션 계정 실측 후 소유 만다라로 노트 모드 렌더 확인) → 오너 실클릭 실수신.
- **데이터 안전**: 실사용자 행 무접촉 (샘플·테스트는 오너 주소 한정, 리셋은 단일행 스냅샷 선행).
- **사고/우회 기록**: 검증 표본이 실사용자 조건(스테일 SW·세션 계정·실데이터 소스)을 대표하지 못해 3회 재작업 — troubleshooting에 패턴 등재, /retro 제안으로 통합 패밀리화.
