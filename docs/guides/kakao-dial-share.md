# 다이얼(/dial) — 카카오톡 공유 가이드

**Context:** `insighta.one/dial`은 정적 랜딩 페이지로, 카카오톡 공유는 **URL 붙여넣기 → OG 카드 unfurl** 방식이다 (학습페이지의 Kakao SDK 공유 버튼과는 다른 메커니즘 — 그쪽은 `docs/guides/kakao-share-setup.md`). 앱 키·SDK·개발자 콘솔 설정이 전혀 필요 없다. 카카오 스크래퍼가 페이지의 `<meta property="og:*">`를 읽어 카드를 만든다.

## 1. 공유 방법

카카오톡 채팅창에 URL을 붙여넣으면 끝:

```
https://insighta.one/dial/
```

카드 구성 (모두 `frontend/public/dial/index.html`의 OG 메타에서 나옴):

| 요소 | 값 | 바꾸려면 |
|------|-----|---------|
| 이미지 | `frontend/public/dial/og.png` (1200×630) | 파일 교체 후 배포 + 캐시 초기화(§3) |
| 제목 | `og:title` — "다이얼 — 내 유튜브를 나만의 지식노트로" | index.html 메타 수정 |
| 설명 | `og:description` | index.html 메타 수정 |

모바일 플레이어의 48시간 게스트 링크(`insighta.one/mobile/?g=...`)도 동일 원리로 `/mobile`의 OG 메타 카드가 뜬다.

## 2. 슬래시 유무

- `insighta.one/dial/` (슬래시 O) — 항상 동작.
- `insighta.one/dial` (슬래시 X) — nginx가 `/dial/`로 301 리다이렉트. 2026-07-14 이전에는 이 리다이렉트가 내부 포트(`http://…:8081`)로 나가 카카오 스크래퍼가 도달 불가였다. `absolute_redirect off` 수정으로 해소 (nginx.conf.template).

## 3. 카카오 캐시 초기화 (카드가 옛날 것으로 뜰 때)

카카오는 **URL 문자열 단위로** 스크랩 결과를 수 주간 캐시한다. 배포 전에 시도했던 URL은 옛 카드(예: 베타 카드)가 계속 뜬다.

1. https://developers.kakao.com 로그인 (카카오 계정)
2. 상단 **도구 → 공유 디버거** (https://developers.kakao.com/tool/debugger/sharing)
3. URL 입력 (`https://insighta.one/dial` — 슬래시 유무별로 각각) → **초기화** 버튼
4. 같은 화면에서 미리보기로 새 카드 확인 → 카톡에서 재시도

## 4. 배포 후 검증 체크리스트

```bash
# 1) OG 메타 존재
curl -sL https://insighta.one/dial | grep -c 'og:image'   # ≥ 1

# 2) 이미지 접근
curl -s -o /dev/null -w "%{http_code}" https://insighta.one/dial/og.png  # 200

# 3) 슬래시 없는 리다이렉트가 상대경로인지
curl -sI https://insighta.one/dial | grep -i '^location'  # Location: /dial/
```

마지막으로 카카오톡 "나에게 보내기"로 실카드 확인.

## 5. 주의

- claude.ai 아티팩트 URL은 로그인 게이트라 카카오에서 카드도 내용도 안 보인다. 대외 공유물은 반드시 insighta.one 아래에 배포한다.
- OG 이미지를 바꾸면 반드시 §3 캐시 초기화를 해야 반영된다.
