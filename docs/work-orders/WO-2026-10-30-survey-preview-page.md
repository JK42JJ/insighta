---
id: WO-2026-10-30-survey-preview-page
status: running
owner: insighta-session
opened: 2026-10-30
---

# 목표

`https://insighta.one/survey/` 가 카카오톡 미리보기용 Open Graph 정보를 HTML 로 응답하고, 열면 구글폼으로 이동한다. 사용자 조사(설문)를 단톡방에 공유하기 위한 정적 페이지다.

# 맥락

- 운영 서빙(2026-10-30 실측): ingress-nginx → `insighta-frontend` 파드(nginx, 루트 `/usr/share/nginx/html`). `location /` 가 `try_files $uri $uri/ /index.html` 이라, 파일이 있으면 앱 셸보다 먼저 서빙된다. 호스트 nginx(EC2)는 더 이상 쓰지 않는다(`charts/insighta/templates/ingress.yaml`).
- 카카오톡 미리보기 수집기는 자바스크립트를 실행하지 않는다. og 태그가 응답 HTML 에 있어야 한다.
- 이미지는 `frontend/public` 빌드에 넣지 않는다 — 그러면 이미지 빌드와 배포가 필요하다. 차트의 ConfigMap 을 프론트 파드에 마운트한다.

# 제약

- HTML 은 핸드오프 원문 그대로(수정 금지). 이미지는 James 가 준 `survey-og.jpg`(1200×630, 87,888B) 그대로.
- 기존 환경(dev · validation · staging)의 렌더는 변하지 않는다 — `survey.enabled` 기본 false, prod 만 true.
- 앱 이미지·API·라우트 무변경. 로그인·인증 경로를 타지 않는다(nginx 정적 서빙).
- 운영 반영(머지 = ArgoCD 자동 반영)은 James 승인 후.

# 순서

1. 차트: `files/survey/{index.html,survey-og.jpg}` · `templates/survey.yaml`(ConfigMap) · `frontend.yaml`(볼륨·마운트·체크섬) · `values.yaml` / `prod.yaml`.
2. 로컬 검증: 운영 nginx 설정 그대로 컨테이너로 라우팅 확인. 서버 측 드라이런.
3. James 승인 → `merge-green.sh` → ArgoCD 반영(프론트 3파드 롤링).
4. 완료 기준 1~4 를 운영에 대해 실행, James 가 카톡 썸네일 확인.

# 검증 기준

- [x] prod 렌더 외 환경 렌더 diff 0줄 (dev · validation · staging)
- [x] 렌더된 ConfigMap 의 HTML · JPEG 가 원본과 바이트 동일
- [x] 로컬 nginx(운영 설정): `/survey/` 가 og 페이지, `/survey` 는 301 → `/survey/`, `survey-og.jpg` 는 200 `image/jpeg`, `/` 와 앱 경로는 앱 셸
- [x] `kubectl apply --server-side --dry-run=server` 통과 (insighta-prod)
- [ ] 운영: `curl -s https://insighta.one/survey/` 에 `og:image` 줄
- [ ] 운영: `curl -sI https://insighta.one/survey/survey-og.jpg` → 200, `content-type: image/jpeg`
- [ ] 시크릿 창에서 `/survey/` 가 구글폼으로 이동, 메인 페이지·로그인 정상
- [ ] James 가 카톡에서 썸네일 확인

# 롤백

`prod.yaml` 의 `survey.enabled` 를 false 로 되돌리는 커밋(또는 커밋 revert). 프론트 파드가 롤링으로 이전 상태로 돌아간다.
