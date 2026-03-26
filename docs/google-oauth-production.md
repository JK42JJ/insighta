# Google OAuth Production 전환 가이드

> Issue: [#2 Google OAuth → Production](https://github.com/JK42JJ/insighta/issues/2)

## 현재 상태

- **OAuth 모드**: Testing (100명 제한)
- **목표**: Production 전환 → 일반 사용자 접근 허용

## 전제 조건 (모두 완료)

| 항목 | URL / 값 | 상태 |
|------|-----------|------|
| Privacy Policy | `https://insighta.one/privacy` (`frontend/src/pages/Privacy.tsx`) | 완료 |
| Terms of Service | `https://insighta.one/terms` (`frontend/src/pages/Terms.tsx`) | 완료 |
| Homepage | `https://insighta.one` | 완료 |
| OAuth Scope | `youtube.readonly` (비민감 스코프) | 완료 |
| Redirect URI | `https://insighta.one/oauth/callback` | 완료 |
| 라우팅 | `App.tsx:35-36`에서 `/privacy`, `/terms` 라우트 등록 | 완료 |
| 연락처 | `admin@insighta.one` | 완료 |

## 실행 절차 (Google Cloud Console 수동 작업)

### Step 1: OAuth Consent Screen 정보 확인/업데이트

1. [Google Cloud Console](https://console.cloud.google.com) 접속
2. **API & Services** → **OAuth consent screen** 이동
3. 아래 항목 확인 및 입력:

| 필드 | 값 |
|------|-----|
| App name | `Insighta` |
| User support email | `admin@insighta.one` |
| App homepage | `https://insighta.one` |
| Privacy policy link | `https://insighta.one/privacy` |
| Terms of service link | `https://insighta.one/terms` |
| Authorized domains | `insighta.one` |
| Developer contact email | `admin@insighta.one` |

### Step 2: Scopes 확인

- **사용 중 스코프**: `youtube.readonly` (비민감)
- 비민감 스코프만 사용하므로 Google 심사가 간소화됨
- 추가 스코프 불필요

### Step 3: PUBLISH APP 실행

1. OAuth consent screen 페이지 상단의 **"PUBLISH APP"** 버튼 클릭
2. 확인 다이얼로그에서 **"Confirm"** 클릭
3. `youtube.readonly`는 비민감 스코프이므로 **즉시 승인** 또는 빠른 심사 예상

### Step 4: 승인 후 검증

- [ ] OAuth consent screen 상태 → **"In production"** 확인
- [ ] 테스트 유저 목록에 없는 새 Google 계정으로 로그인 테스트
- [ ] `https://insighta.one/privacy` 정상 접근 확인
- [ ] `https://insighta.one/terms` 정상 접근 확인

## 참고 사항

- **비민감 스코프**만 사용하므로 심사가 빠름 (즉시 ~ 수일)
- 향후 민감/제한 스코프 추가 시 별도 심사 필요 (현재 해당 없음)
- Testing 모드에서도 100명까지 사용 가능하므로 긴급하지 않음
- Production 전환 후에도 기존 테스트 유저는 영향 없음

## 관련 코드 참조

```
frontend/src/pages/Privacy.tsx    # Privacy Policy 페이지
frontend/src/pages/Terms.tsx      # Terms of Service 페이지
frontend/src/App.tsx:35-36        # 라우트 등록
frontend/src/pages/Login.tsx      # 약관 동의 링크
frontend/src/components/Header.tsx # 헤더 내 링크
frontend/src/components/Footer.tsx # 푸터 내 링크
```
