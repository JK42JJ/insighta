# API 엔드포인트 설계

**프로젝트**: Insighta API
**버전**: v1
**마지막 업데이트**: 2025-12-16

---

## 📋 목차

1. [API 아키텍처](#api-아키텍처)
2. [인증 및 권한](#인증-및-권한)
3. [API 엔드포인트](#api-엔드포인트)
4. [데이터 모델](#데이터-모델)
5. [에러 처리](#에러-처리)
6. [Rate Limiting](#rate-limiting)
7. [버전 관리](#버전-관리)

---

## API 아키텍처

### 기술 스택

- **API 프레임워크**: Fastify (고성능, TypeScript 지원 우수)
- **데이터베이스**: SQLite (개발), PostgreSQL (프로덕션)
- **ORM**: Prisma
- **인증**: JWT (JSON Web Tokens) + API Key (선택적)
- **문서화**: OpenAPI 3.1 + Docusaurus + Scalar
- **검증**: Zod (스키마 검증)

### 아키텍처 레이어

```
┌─────────────────────────────────────┐
│   API Gateway (Fastify)             │
│   - Rate Limiting                   │
│   - Authentication                  │
│   - Request Validation              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   API Routes Layer                  │
│   - /api/v1/playlists               │
│   - /api/v1/videos                  │
│   - /api/v1/analytics               │
│   - /api/v1/sync                    │
│   - /api/v1/auth                    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Business Logic (Existing Modules) │
│   - PlaylistManager                 │
│   - VideoManager                    │
│   - SyncEngine                      │
│   - AnalyticsService                │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Data Access Layer (Prisma ORM)    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Database (SQLite/PostgreSQL)      │
└─────────────────────────────────────┘
```

---

## 인증 및 권한

### 인증 방식

#### 1. JWT 토큰 (주요 방식)

**로그인 플로우**:
```
POST /api/v1/auth/login
{
  "username": "user@example.com",
  "password": "secure_password"
}

Response:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

**인증 헤더**:
```
Authorization: Bearer <accessToken>
```

**토큰 갱신**:
```
POST /api/v1/auth/refresh
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### 2. API Key (선택적, 서버 간 통신용)

**헤더 방식**:
```
X-API-Key: your_api_key_here
```

**사용 사례**:
- 자동화 스크립트
- CI/CD 파이프라인
- 외부 서비스 통합

### 권한 레벨

| 레벨 | 권한 | 설명 |
|------|------|------|
| `user` | 읽기, 쓰기 (본인 데이터만) | 일반 사용자 |
| `admin` | 전체 읽기, 쓰기, 삭제 | 관리자 |
| `api` | 읽기 전용 | API Key 사용자 |

---

## API 엔드포인트

### Base URL

```
Development: http://localhost:3000/api/v1
Production: https://api.yourdomain.com/api/v1
```

---

### 1. Authentication API

#### `POST /auth/register`
새 사용자 등록

**Request**:
```json
{
  "email": "user@example.com",
  "password": "secure_password",
  "username": "username"
}
```

**Response** (201 Created):
```json
{
  "id": "user_123",
  "email": "user@example.com",
  "username": "username",
  "createdAt": "2025-12-16T10:00:00Z"
}
```

#### `POST /auth/login`
로그인 및 토큰 발급

**Request**:
```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "username": "username"
  }
}
```

#### `POST /auth/refresh`
액세스 토큰 갱신

**Request**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

#### `POST /auth/logout`
로그아웃 (토큰 무효화)

**Request**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response** (204 No Content)

---

### 2. Playlists API

#### `GET /playlists`
모든 플레이리스트 조회

**Query Parameters**:
- `page` (optional): 페이지 번호 (기본값: 1)
- `limit` (optional): 페이지당 항목 수 (기본값: 20, 최대: 100)
- `sort` (optional): 정렬 기준 (`createdAt`, `updatedAt`, `title`) (기본값: `updatedAt`)
- `order` (optional): 정렬 순서 (`asc`, `desc`) (기본값: `desc`)

**Response** (200 OK):
```json
{
  "playlists": [
    {
      "id": "playlist_123",
      "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
      "title": "My Learning Playlist",
      "description": "Educational videos",
      "thumbnail": "https://i.ytimg.com/vi/...",
      "videoCount": 25,
      "lastSyncedAt": "2025-12-16T09:30:00Z",
      "createdAt": "2025-12-01T10:00:00Z",
      "updatedAt": "2025-12-16T09:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3
  }
}
```

#### `GET /playlists/:id`
특정 플레이리스트 상세 조회

**Path Parameters**:
- `id`: 플레이리스트 ID

**Query Parameters**:
- `includeVideos` (optional): 비디오 목록 포함 여부 (기본값: false)

**Response** (200 OK):
```json
{
  "id": "playlist_123",
  "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
  "title": "My Learning Playlist",
  "description": "Educational videos",
  "thumbnail": "https://i.ytimg.com/vi/...",
  "videoCount": 25,
  "lastSyncedAt": "2025-12-16T09:30:00Z",
  "createdAt": "2025-12-01T10:00:00Z",
  "updatedAt": "2025-12-16T09:30:00Z",
  "videos": [
    {
      "id": "video_456",
      "youtubeId": "dQw4w9WgXcQ",
      "title": "Video Title",
      "position": 1
    }
  ]
}
```

#### `POST /playlists`
플레이리스트 임포트

**Request**:
```json
{
  "url": "https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
}
```

또는

```json
{
  "playlistId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"
}
```

**Response** (201 Created):
```json
{
  "id": "playlist_123",
  "youtubeId": "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf",
  "title": "My Learning Playlist",
  "videoCount": 25,
  "status": "importing",
  "createdAt": "2025-12-16T10:00:00Z"
}
```

#### `DELETE /playlists/:id`
플레이리스트 삭제 (로컬 데이터만)

**Path Parameters**:
- `id`: 플레이리스트 ID

**Response** (204 No Content)

---

### 3. Videos API

#### `GET /videos`
비디오 목록 조회

**Query Parameters**:
- `playlistId` (optional): 특정 플레이리스트의 비디오만 조회
- `page` (optional): 페이지 번호 (기본값: 1)
- `limit` (optional): 페이지당 항목 수 (기본값: 20, 최대: 100)
- `search` (optional): 제목/설명 검색

**Response** (200 OK):
```json
{
  "videos": [
    {
      "id": "video_456",
      "youtubeId": "dQw4w9WgXcQ",
      "title": "Video Title",
      "description": "Video description",
      "duration": 213,
      "thumbnail": "https://i.ytimg.com/vi/...",
      "publishedAt": "2025-01-01T00:00:00Z",
      "viewCount": 1000000,
      "likeCount": 50000,
      "hasCaptions": true,
      "captionLanguages": ["en", "ko", "ja"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 500,
    "totalPages": 25
  }
}
```

#### `GET /videos/:id`
비디오 상세 정보 조회

**Path Parameters**:
- `id`: 비디오 ID

**Query Parameters**:
- `includeNotes` (optional): 노트 포함 여부 (기본값: false)
- `includeSummary` (optional): 요약 포함 여부 (기본값: false)

**Response** (200 OK):
```json
{
  "id": "video_456",
  "youtubeId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "description": "Video description",
  "duration": 213,
  "thumbnail": "https://i.ytimg.com/vi/...",
  "publishedAt": "2025-01-01T00:00:00Z",
  "viewCount": 1000000,
  "likeCount": 50000,
  "hasCaptions": true,
  "captionLanguages": ["en", "ko", "ja"],
  "watchStatus": {
    "isWatched": true,
    "lastWatchedAt": "2025-12-15T20:00:00Z",
    "watchedDuration": 213,
    "completionRate": 100
  },
  "summary": {
    "id": "summary_789",
    "level": "short",
    "content": "AI-generated summary...",
    "generatedAt": "2025-12-15T20:05:00Z"
  },
  "notes": [
    {
      "id": "note_101",
      "timestamp": 45,
      "content": "Important concept at 0:45",
      "createdAt": "2025-12-15T20:01:00Z"
    }
  ]
}
```

#### `POST /videos/:id/captions`
비디오 자막 다운로드

**Path Parameters**:
- `id`: 비디오 ID

**Query Parameters**:
- `language` (optional): 언어 코드 (기본값: 'en')

**Response** (200 OK):
```json
{
  "videoId": "video_456",
  "language": "en",
  "captions": [
    {
      "text": "Hello, world!",
      "start": 0.0,
      "duration": 2.5
    },
    {
      "text": "This is a caption.",
      "start": 2.5,
      "duration": 3.0
    }
  ],
  "downloadedAt": "2025-12-16T10:00:00Z"
}
```

#### `POST /videos/:id/summarize`
비디오 AI 요약 생성

**Path Parameters**:
- `id`: 비디오 ID

**Request**:
```json
{
  "level": "short",
  "language": "ko"
}
```

**Parameters**:
- `level`: `short`, `medium`, `detailed` (기본값: `medium`)
- `language`: 요약 언어 (기본값: `ko`)

**Response** (201 Created):
```json
{
  "id": "summary_789",
  "videoId": "video_456",
  "level": "short",
  "language": "ko",
  "content": "이 비디오는 ~~에 대해 설명합니다...",
  "generatedAt": "2025-12-16T10:05:00Z"
}
```

#### `POST /videos/:id/notes`
비디오에 노트 추가

**Path Parameters**:
- `id`: 비디오 ID

**Request**:
```json
{
  "timestamp": 45,
  "content": "Important concept at 0:45"
}
```

**Response** (201 Created):
```json
{
  "id": "note_101",
  "videoId": "video_456",
  "timestamp": 45,
  "content": "Important concept at 0:45",
  "createdAt": "2025-12-16T10:00:00Z"
}
```

#### `GET /videos/:id/notes`
비디오의 모든 노트 조회

**Path Parameters**:
- `id`: 비디오 ID

**Response** (200 OK):
```json
{
  "notes": [
    {
      "id": "note_101",
      "timestamp": 45,
      "content": "Important concept at 0:45",
      "createdAt": "2025-12-16T10:00:00Z"
    }
  ]
}
```

#### `PUT /videos/:id/notes/:noteId`
노트 수정

**Path Parameters**:
- `id`: 비디오 ID
- `noteId`: 노트 ID

**Request**:
```json
{
  "timestamp": 45,
  "content": "Updated note content"
}
```

**Response** (200 OK):
```json
{
  "id": "note_101",
  "timestamp": 45,
  "content": "Updated note content",
  "updatedAt": "2025-12-16T10:10:00Z"
}
```

#### `DELETE /videos/:id/notes/:noteId`
노트 삭제

**Path Parameters**:
- `id`: 비디오 ID
- `noteId`: 노트 ID

**Response** (204 No Content)

---

### 4. Analytics API

#### `GET /analytics/overview`
전체 학습 통계

**Response** (200 OK):
```json
{
  "totalPlaylists": 10,
  "totalVideos": 250,
  "totalWatchedVideos": 150,
  "totalWatchTime": 75600,
  "averageCompletionRate": 85.5,
  "totalNotes": 320,
  "recentActivity": [
    {
      "type": "video_watched",
      "videoId": "video_456",
      "timestamp": "2025-12-16T09:00:00Z"
    }
  ]
}
```

#### `GET /analytics/videos/:id`
특정 비디오 학습 통계

**Path Parameters**:
- `id`: 비디오 ID

**Response** (200 OK):
```json
{
  "videoId": "video_456",
  "watchCount": 3,
  "totalWatchTime": 639,
  "averageWatchDuration": 213,
  "completionRate": 100,
  "noteCount": 5,
  "lastWatchedAt": "2025-12-15T20:00:00Z",
  "retentionScore": 85
}
```

#### `GET /analytics/retention/:id`
비디오 복습 추천 (Spaced Repetition)

**Path Parameters**:
- `id`: 비디오 ID

**Response** (200 OK):
```json
{
  "videoId": "video_456",
  "retentionScore": 85,
  "nextReviewDate": "2025-12-20T00:00:00Z",
  "reviewInterval": 7,
  "reviewCount": 3,
  "lastReviewedAt": "2025-12-13T10:00:00Z"
}
```

#### `GET /analytics/dashboard`
학습 대시보드 데이터

**Query Parameters**:
- `startDate` (optional): 시작 날짜 (ISO 8601)
- `endDate` (optional): 종료 날짜 (ISO 8601)

**Response** (200 OK):
```json
{
  "period": {
    "startDate": "2025-12-01T00:00:00Z",
    "endDate": "2025-12-16T23:59:59Z"
  },
  "statistics": {
    "videosWatched": 45,
    "totalWatchTime": 12600,
    "notesCreated": 78,
    "averageCompletionRate": 88.2
  },
  "charts": {
    "dailyActivity": [
      {
        "date": "2025-12-16",
        "videosWatched": 3,
        "watchTime": 900
      }
    ],
    "completionRates": [
      {
        "playlistId": "playlist_123",
        "completionRate": 75.5
      }
    ]
  }
}
```

---

### 5. Sync API

#### `POST /sync/playlists/:id`
특정 플레이리스트 동기화

**Path Parameters**:
- `id`: 플레이리스트 ID

**Response** (200 OK):
```json
{
  "playlistId": "playlist_123",
  "status": "syncing",
  "jobId": "sync_job_456",
  "startedAt": "2025-12-16T10:00:00Z"
}
```

#### `POST /sync/playlists`
모든 플레이리스트 동기화

**Response** (200 OK):
```json
{
  "status": "syncing",
  "totalPlaylists": 10,
  "jobIds": ["sync_job_456", "sync_job_457"],
  "startedAt": "2025-12-16T10:00:00Z"
}
```

#### `GET /sync/status/:jobId`
동기화 작업 상태 조회

**Path Parameters**:
- `jobId`: 작업 ID

**Response** (200 OK):
```json
{
  "jobId": "sync_job_456",
  "status": "completed",
  "playlistId": "playlist_123",
  "progress": {
    "total": 25,
    "processed": 25,
    "added": 3,
    "updated": 2,
    "deleted": 1
  },
  "startedAt": "2025-12-16T10:00:00Z",
  "completedAt": "2025-12-16T10:02:30Z",
  "quotaUsed": 3
}
```

#### `POST /sync/schedule`
자동 동기화 스케줄 설정

**Request**:
```json
{
  "interval": "1h",
  "playlists": ["playlist_123", "playlist_456"]
}
```

**Parameters**:
- `interval`: `15m`, `30m`, `1h`, `6h`, `12h`, `24h`
- `playlists`: 대상 플레이리스트 ID 배열 (비어있으면 전체)

**Response** (200 OK):
```json
{
  "scheduleId": "schedule_789",
  "interval": "1h",
  "playlists": ["playlist_123", "playlist_456"],
  "nextRunAt": "2025-12-16T11:00:00Z",
  "createdAt": "2025-12-16T10:00:00Z"
}
```

#### `GET /sync/schedules`
모든 동기화 스케줄 조회

**Response** (200 OK):
```json
{
  "schedules": [
    {
      "scheduleId": "schedule_789",
      "interval": "1h",
      "playlists": ["playlist_123"],
      "isActive": true,
      "nextRunAt": "2025-12-16T11:00:00Z"
    }
  ]
}
```

#### `DELETE /sync/schedules/:id`
동기화 스케줄 삭제

**Path Parameters**:
- `id`: 스케줄 ID

**Response** (204 No Content)

---

## 데이터 모델

### Playlist

```typescript
interface Playlist {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  videoCount: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Video

```typescript
interface Video {
  id: string;
  youtubeId: string;
  title: string;
  description: string | null;
  duration: number; // seconds
  thumbnail: string | null;
  publishedAt: Date;
  viewCount: number;
  likeCount: number;
  hasCaptions: boolean;
  captionLanguages: string[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Note

```typescript
interface Note {
  id: string;
  videoId: string;
  timestamp: number; // seconds
  content: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Summary

```typescript
interface Summary {
  id: string;
  videoId: string;
  level: 'short' | 'medium' | 'detailed';
  language: string;
  content: string;
  generatedAt: Date;
}
```

---

## 에러 처리

### 표준 에러 응답

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Playlist not found",
    "details": {
      "playlistId": "playlist_123"
    },
    "timestamp": "2025-12-16T10:00:00Z",
    "path": "/api/v1/playlists/playlist_123"
  }
}
```

### 에러 코드

| HTTP 코드 | 에러 코드 | 설명 |
|-----------|----------|------|
| 400 | `INVALID_REQUEST` | 잘못된 요청 파라미터 |
| 401 | `UNAUTHORIZED` | 인증 실패 |
| 403 | `FORBIDDEN` | 권한 없음 |
| 404 | `RESOURCE_NOT_FOUND` | 리소스를 찾을 수 없음 |
| 409 | `RESOURCE_CONFLICT` | 리소스 충돌 |
| 422 | `VALIDATION_ERROR` | 검증 실패 |
| 429 | `RATE_LIMIT_EXCEEDED` | Rate Limit 초과 |
| 500 | `INTERNAL_SERVER_ERROR` | 서버 내부 오류 |
| 503 | `SERVICE_UNAVAILABLE` | 서비스 일시 중단 |

### Validation Error 상세 응답

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "errors": [
        {
          "field": "email",
          "message": "Invalid email format"
        },
        {
          "field": "password",
          "message": "Password must be at least 8 characters"
        }
      ]
    },
    "timestamp": "2025-12-16T10:00:00Z",
    "path": "/api/v1/auth/register"
  }
}
```

---

## Rate Limiting

### 제한 정책

| 사용자 유형 | 제한 |
|------------|------|
| 인증되지 않은 사용자 | 100 requests/hour |
| 일반 사용자 (JWT) | 1000 requests/hour |
| API Key 사용자 | 5000 requests/hour |
| 관리자 | 10000 requests/hour |

### Rate Limit 응답 헤더

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1702742400
```

### Rate Limit 초과 응답

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again in 3600 seconds.",
    "details": {
      "limit": 1000,
      "remaining": 0,
      "resetAt": "2025-12-16T11:00:00Z"
    }
  }
}
```

---

## 버전 관리

### URL 기반 버전 관리

```
/api/v1/playlists
/api/v2/playlists  (향후)
```

### 버전 정책

- **Major Version (v1 → v2)**: Breaking changes (URL 변경)
- **Minor Version**: 기능 추가, 하위 호환성 유지 (헤더로 관리)
- **Patch Version**: 버그 수정 (투명하게 적용)

### 버전 헤더 (선택적)

```
API-Version: 1.2.0
```

---

## 다음 단계

1. ✅ API 엔드포인트 설계 완료
2. ⏳ OpenAPI 명세 자동 생성 구조 설계
3. ⏳ Fastify 프로젝트 초기 설정
4. ⏳ 인증 미들웨어 구현
5. ⏳ API 라우터 구현
6. ⏳ Docusaurus 문서 사이트 구축
7. ⏳ Scalar API 레퍼런스 통합

---

**문서 버전**: 1.0
**작성자**: James Kim (jamesjk4242@gmail.com)
**작성일**: 2025-12-16
