# 10. Supabase Edge Functions 통합

**구현 일자**: 2025-12-21
**Phase**: 5.1 - Supabase Edge Functions Integration
**상태**: ✅ 완료

---

## 📋 개요

Supabase Self-Hosted 환경에서 YouTube OAuth 인증 및 플레이리스트 동기화를 위한 Edge Functions 구현.

### 구현 목표
1. YouTube OAuth 2.0 플로우 구현 (Edge Function)
2. 플레이리스트 동기화 API 구현
3. Kong API Gateway 설정
4. 프론트엔드 React Query 훅 연동

---

## 🏗️ 아키텍처

### 시스템 구성도

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                             │
│  ┌──────────────────┐   ┌──────────────────┐                        │
│  │ useYouTubeAuth   │   │ useYouTubeSync   │                        │
│  └────────┬─────────┘   └────────┬─────────┘                        │
└───────────┼──────────────────────┼──────────────────────────────────┘
            │                      │
            ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Kong API Gateway (:8000)                          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ /functions/v1/youtube-auth         → functions:9000 (key-auth)  │ │
│  │ /functions/v1/youtube-auth-callback → functions:9000 (open)     │ │
│  │ /functions/v1/youtube-sync         → functions:9000 (key-auth)  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Supabase Edge Functions (Deno :9000)                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ main/index.ts                                                  │   │
│  │  ├── handleYouTubeAuth() - OAuth 인증 플로우                   │   │
│  │  └── handleYouTubeSync() - 플레이리스트 동기화                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    External Services                                 │
│  ┌────────────────┐   ┌─────────────────┐   ┌───────────────────┐  │
│  │ Google OAuth   │   │ YouTube API v3  │   │ Supabase DB       │  │
│  │ accounts.google│   │ googleapis.com  │   │ (PostgreSQL)      │  │
│  └────────────────┘   └─────────────────┘   └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 데이터베이스 테이블

| 테이블 | 설명 |
|--------|------|
| `youtube_sync_settings` | OAuth 토큰, 동기화 설정 저장 |
| `youtube_playlists` | 사용자 플레이리스트 메타데이터 |
| `youtube_videos` | 비디오 메타데이터 (전역) |
| `youtube_playlist_items` | 플레이리스트-비디오 관계 |
| `user_video_states` | 사용자별 비디오 상태 (아이디에이션 팔레트) |

---

## 📁 구현된 파일

### Edge Functions

#### `superbase/volumes/functions/main/index.ts`

**YouTube Auth Handler** (`handleYouTubeAuth`):
- `auth-url`: OAuth 인증 URL 생성
- `callback`: OAuth 콜백 처리, 토큰 저장
- `refresh`: 액세스 토큰 갱신
- `disconnect`: YouTube 계정 연결 해제
- `status`: 연결 상태 조회

**YouTube Sync Handler** (`handleYouTubeSync`):
- `add-playlist`: 플레이리스트 추가
- `list-playlists`: 플레이리스트 목록 조회
- `sync-playlist`: 플레이리스트 동기화 실행
- `delete-playlist`: 플레이리스트 삭제
- `update-settings`: 동기화 설정 업데이트
- `get-ideation-videos`: 아이디에이션 팔레트 비디오 조회
- `update-video-state`: 비디오 상태 업데이트

### Kong API Gateway

#### `superbase/volumes/api/kong.template.yml`

```yaml
# YouTube OAuth Callback - Open route (API key 불필요)
- name: functions-v1-youtube-callback
  url: http://functions:9000/youtube-auth-callback
  routes:
    - name: functions-v1-youtube-callback
      strip_path: true
      paths:
        - /functions/v1/youtube-auth-callback
  plugins:
    - name: cors

# Edge Functions - API key 필요
- name: functions-v1
  url: http://functions:9000/
  routes:
    - name: functions-v1
      strip_path: true
      paths:
        - /functions/v1/
  plugins:
    - name: cors
    - name: key-auth
    - name: acl
```

### 프론트엔드 훅

#### `frontend/src/hooks/useYouTubeAuth.ts`
- `useYouTubeAuthStatus()`: 연결 상태 조회
- `useYouTubeConnect()`: OAuth 연결 시작 (팝업)
- `useYouTubeDisconnect()`: 연결 해제
- `useYouTubeRefreshToken()`: 토큰 갱신
- `useYouTubeAuth()`: 통합 훅

#### `frontend/src/hooks/useYouTubeSync.ts`
- `useYouTubePlaylists()`: 플레이리스트 목록
- `useAddPlaylist()`: 플레이리스트 추가
- `useSyncPlaylist()`: 동기화 실행
- `useDeletePlaylist()`: 플레이리스트 삭제
- `useIdeationVideos()`: 아이디에이션 팔레트 비디오
- `useUpdateVideoState()`: 비디오 상태 업데이트
- `useYouTubeSync()`: 통합 훅

---

## 🔧 주요 구현 사항

### 1. OAuth 2.0 플로우

```
사용자 → "YouTube 연결" 클릭
    │
    ▼
프론트엔드 → youtube-auth?action=auth-url
    │
    ▼
Edge Function → Google OAuth URL 생성 (state에 user_id 포함)
    │
    ▼
프론트엔드 → 팝업 창에서 Google 로그인
    │
    ▼
Google → youtube-auth-callback?code=xxx&state=xxx
    │
    ▼
Edge Function → 토큰 교환 → DB 저장 → HTML 응답 (postMessage)
    │
    ▼
프론트엔드 → 팝업 닫힘 → 상태 새로고침
```

### 2. 플레이리스트 동기화

```
sync-playlist 호출
    │
    ├── 1. YouTube API: playlistItems 조회 (페이징)
    │
    ├── 2. YouTube API: videos 상세 조회 (50개씩 배치)
    │
    ├── 3. DB: youtube_videos 업서트
    │
    ├── 4. DB: youtube_playlist_items 업서트
    │
    ├── 5. DB: user_video_states 생성 (is_in_ideation=true)
    │
    └── 6. DB: 삭제된 항목 표시 (removed_at)
```

### 3. Kong API Gateway 설정

**해결한 문제들**:
1. `redirect_uri_mismatch`: Kong 라우팅 경로 일치 필요
2. `No API key found`: OAuth callback은 open 라우트 필요
3. `apikey` 헤더: 프론트엔드에서 Kong 인증용 헤더 추가

---

## ⚠️ 개선 필요 사항 (TODO)

### 높은 우선순위

| 항목 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 에러 핸들링 | 일반적인 try-catch | 상세한 에러 타입 및 사용자 메시지 |
| 토큰 갱신 | 수동 갱신 | 만료 전 자동 갱신 (background) |
| API 쿼터 | 추적 없음 | 일일 쿼터 사용량 모니터링 |
| 테스트 | 없음 | Edge Function 단위/통합 테스트 |

### 중간 우선순위

| 항목 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 동기화 최적화 | 매번 전체 조회 | ETag 기반 캐싱, 변경분만 동기화 |
| 병렬 처리 | 순차 처리 | 여러 플레이리스트 병렬 동기화 |
| 로깅 | console.log | 구조화된 로깅 (Supabase Logflare) |
| Rate Limiting | 없음 | 사용자별 요청 제한 |

### 낮은 우선순위

| 항목 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 코드 분리 | 단일 파일 | 모듈별 분리 (auth, sync, helpers) |
| 타입 안전성 | 부분적 | 전체 응답 타입 정의 |
| 환경 변수 | 직접 접근 | Zod 스키마 검증 |

---

## 🔒 보안 고려사항

### 구현됨
- ✅ JWT 토큰 검증 (Supabase Auth)
- ✅ Kong API Gateway 인증 (key-auth)
- ✅ OAuth state 파라미터 (CSRF 방지)
- ✅ 사용자별 데이터 격리 (user_id 필터)

### 개선 필요
- ⚠️ OAuth 토큰 암호화 저장 (현재 평문)
- ⚠️ Rate limiting 구현
- ⚠️ 입력 검증 강화 (Zod)
- ⚠️ 감사 로그

---

## 📊 API 엔드포인트 요약

### YouTube Auth (`/functions/v1/youtube-auth`)

| Action | Method | 설명 |
|--------|--------|------|
| `auth-url` | GET | OAuth 인증 URL 생성 |
| `callback` | GET | OAuth 콜백 처리 |
| `refresh` | POST | 토큰 갱신 |
| `disconnect` | POST | 연결 해제 |
| `status` | GET | 연결 상태 조회 |

### YouTube Sync (`/functions/v1/youtube-sync`)

| Action | Method | 설명 |
|--------|--------|------|
| `add-playlist` | POST | 플레이리스트 추가 |
| `list-playlists` | GET | 목록 조회 |
| `sync-playlist` | POST | 동기화 실행 |
| `delete-playlist` | POST | 삭제 |
| `update-settings` | POST | 설정 업데이트 |
| `get-ideation-videos` | GET | 아이디에이션 비디오 |
| `update-video-state` | POST | 비디오 상태 업데이트 |

---

## 🧪 테스트 방법

### Edge Function 테스트

```bash
# 컨테이너 재시작
docker restart supabase-functions-dev

# 로그 확인
docker logs supabase-functions-dev --tail 50

# 상태 확인
curl http://localhost:8000/functions/v1/youtube-auth?action=status \
  -H "Authorization: Bearer <access_token>" \
  -H "apikey: <anon_key>"
```

### 프론트엔드 테스트

1. YouTube 계정 연결
2. 플레이리스트 URL 추가
3. 동기화 버튼 클릭
4. 아이디에이션 팔레트에서 비디오 확인

---

## 📚 참고 자료

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Kong Gateway](https://docs.konghq.com/)
- [YouTube Data API v3](https://developers.google.com/youtube/v3)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)

---

*작성자: James Kim (jamesjk4242@gmail.com)*
*버전: 1.0*
