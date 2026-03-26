# Frontend Integration Guide

> Insighta (Insighta) 프론트엔드 개발을 위한 완전한 API 연동 가이드

**Version**: 2.0.0
**Last Updated**: 2025-12-19
**Total API Endpoints**: 42개

---

## Table of Contents

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택 권장사항](#2-기술-스택-권장사항)
3. [API 기본 정보](#3-api-기본-정보)
4. [인증 시스템](#4-인증-시스템)
5. [화면별 가이드](#5-화면별-가이드)
   - [5.1 로그인/회원가입](#51-로그인회원가입-페이지)
   - [5.2 대시보드](#52-대시보드-페이지)
   - [5.3 플레이리스트 목록](#53-플레이리스트-목록-페이지)
   - [5.4 플레이리스트 상세](#54-플레이리스트-상세-페이지)
   - [5.5 동영상 상세](#55-동영상-상세-페이지)
   - [5.6 노트 관리](#56-노트-관리-페이지)
   - [5.7 분석 대시보드](#57-분석-대시보드-페이지)
   - [5.8 설정/할당량](#58-설정할당량-페이지)
6. [전체 API 레퍼런스](#6-전체-api-레퍼런스-42개)
7. [공통 컴포넌트 설계](#7-공통-컴포넌트-설계)
8. [상태 관리 패턴](#8-상태-관리-패턴)
9. [에러 처리 패턴](#9-에러-처리-패턴)
10. [코드 예제](#10-코드-예제)

---

## 1. 프로젝트 개요

### 1.1 Insighta란?

YouTube 플레이리스트 기반 학습 관리 플랫폼입니다. 다음 기능을 제공합니다:

- **플레이리스트 동기화**: YouTube 플레이리스트 가져오기 및 자동 동기화
- **자막 추출**: 7개 언어 지원, 다국어 자막 처리
- **AI 요약**: Gemini/OpenAI 기반 동영상 내용 요약
- **개인 메모**: 타임스탬프 기반 노트 작성
- **학습 분석**: 시청 진도 추적 및 대시보드

### 1.2 아키텍처 개요

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│   Frontend      │────▶│   REST API      │────▶│   Database      │
│   (React/Next)  │     │   (Fastify)     │     │   (SQLite/PG)   │
│                 │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌─────────────────┐
                        │  YouTube API    │
                        │  Gemini API     │
                        └─────────────────┘
```

---

## 2. 기술 스택 권장사항

### 2.1 프론트엔드 프레임워크

| 옵션 | 설명 | 권장도 |
|------|------|--------|
| **Next.js 14+** | React 기반, SSR/SSG 지원, App Router | ⭐⭐⭐ (권장) |
| **React 18+** | SPA, Vite와 함께 사용 | ⭐⭐ |
| **Vue 3** | Composition API 사용 | ⭐⭐ |

### 2.2 상태 관리

| 라이브러리 | 용도 | 권장도 |
|------------|------|--------|
| **Zustand** | 글로벌 상태 (인증, 사용자) | ⭐⭐⭐ |
| **TanStack Query** | 서버 상태 (API 캐싱) | ⭐⭐⭐ |
| **Jotai** | 로컬 상태 관리 | ⭐⭐ |

### 2.3 UI 라이브러리

| 라이브러리 | 설명 | 권장도 |
|------------|------|--------|
| **Tailwind CSS** | 유틸리티 우선 CSS | ⭐⭐⭐ |
| **shadcn/ui** | Radix 기반 컴포넌트 | ⭐⭐⭐ |
| **Framer Motion** | 애니메이션 | ⭐⭐ |

### 2.4 기타 도구

```json
{
  "dependencies": {
    "@tanstack/react-query": "^5.0.0",
    "axios": "^1.6.0",
    "zustand": "^4.4.0",
    "dayjs": "^1.11.0",
    "zod": "^3.22.0",
    "react-hook-form": "^7.48.0"
  }
}
```

---

## 3. API 기본 정보

### 3.1 Base URL

```
개발 환경: http://localhost:3000/api/v1
프로덕션: https://api.insighta.app/api/v1
```

### 3.2 요청 형식

```typescript
// 모든 요청은 JSON 형식
Content-Type: application/json

// 인증이 필요한 요청
Authorization: Bearer <access_token>
```

### 3.3 응답 형식

```typescript
// 성공 응답 (200, 201)
{
  "data": { ... }
}

// 목록 응답 (페이지네이션)
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}

// 에러 응답 (4xx, 5xx)
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token",
    "details": { ... }
  }
}
```

### 3.4 HTTP 상태 코드

| 코드 | 의미 | 설명 |
|------|------|------|
| 200 | OK | 성공 |
| 201 | Created | 리소스 생성 성공 |
| 400 | Bad Request | 잘못된 요청 |
| 401 | Unauthorized | 인증 필요/실패 |
| 403 | Forbidden | 권한 없음 |
| 404 | Not Found | 리소스 없음 |
| 409 | Conflict | 리소스 충돌 |
| 429 | Too Many Requests | Rate Limit 초과 |
| 500 | Internal Server Error | 서버 에러 |

---

## 4. 인증 시스템

### 4.1 토큰 구조

```typescript
interface AuthTokens {
  accessToken: string;   // JWT, 15분 유효
  refreshToken: string;  // JWT, 7일 유효
  expiresIn: number;     // 900 (초)
}
```

### 4.2 JWT Payload

```typescript
interface JWTPayload {
  userId: string;    // UUID
  email: string;
  name: string;
  iat: number;       // 발급 시간
  exp: number;       // 만료 시간
}
```

### 4.3 토큰 저장 전략

```typescript
// 권장: HttpOnly Cookie + 메모리
// 또는: localStorage (XSS 주의)

// 토큰 저장 유틸리티 예시
const TokenStorage = {
  setTokens: (tokens: AuthTokens) => {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    localStorage.setItem('expiresAt', String(Date.now() + tokens.expiresIn * 1000));
  },

  getAccessToken: () => localStorage.getItem('accessToken'),
  getRefreshToken: () => localStorage.getItem('refreshToken'),

  isTokenExpired: () => {
    const expiresAt = localStorage.getItem('expiresAt');
    return !expiresAt || Date.now() > Number(expiresAt);
  },

  clearTokens: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('expiresAt');
  }
};
```

### 4.4 토큰 자동 갱신

```typescript
// Axios Interceptor 예시
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
});

// 요청 인터셉터: 토큰 추가
api.interceptors.request.use(async (config) => {
  const token = TokenStorage.getAccessToken();

  if (token) {
    // 토큰 만료 1분 전에 갱신
    if (TokenStorage.isTokenExpired()) {
      try {
        const refreshToken = TokenStorage.getRefreshToken();
        const response = await axios.post('/api/v1/auth/refresh', { refreshToken });
        TokenStorage.setTokens(response.data.tokens);
      } catch (error) {
        TokenStorage.clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    config.headers.Authorization = `Bearer ${TokenStorage.getAccessToken()}`;
  }

  return config;
});

// 응답 인터셉터: 401 처리
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      TokenStorage.clearTokens();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

## 5. 화면별 가이드

### 5.1 로그인/회원가입 페이지

#### 와이어프레임

```
+--------------------------------------------------+
|                                                  |
|                    INSIGHTA                      |
|            YouTube Learning Platform              |
|                                                  |
+--------------------------------------------------+
|                                                  |
|              +------------------------+          |
|              |                        |          |
|              |   [Logo / Icon]        |          |
|              |                        |          |
|              +------------------------+          |
|                                                  |
|     +--------------------------------------+     |
|     |  Email                               |     |
|     |  user@example.com                    |     |
|     +--------------------------------------+     |
|                                                  |
|     +--------------------------------------+     |
|     |  Password                            |     |
|     |  ••••••••                            |     |
|     +--------------------------------------+     |
|                                                  |
|     +--------------------------------------+     |
|     |          [  Login  ]                 |     |
|     +--------------------------------------+     |
|                                                  |
|         Don't have an account? Sign up           |
|                                                  |
+--------------------------------------------------+

[회원가입 폼 - 추가 필드]

|     +--------------------------------------+     |
|     |  Name                                |     |
|     |  John Doe                            |     |
|     +--------------------------------------+     |
|                                                  |
|     Password Requirements:                       |
|     - At least 8 characters                      |
|     - Uppercase, lowercase, number, special char |
|                                                  |
+--------------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| POST | `/auth/register` | 회원가입 | ❌ |
| POST | `/auth/login` | 로그인 | ❌ |
| POST | `/auth/refresh` | 토큰 갱신 | ❌ |

#### API 상세

##### POST /auth/register

```typescript
// Request
interface RegisterRequest {
  email: string;      // 이메일 (최대 255자)
  password: string;   // 비밀번호 (8-128자, 대소문자+숫자+특수문자)
  name: string;       // 이름 (1-100자)
}

// Response 201
interface RegisterResponse {
  user: {
    id: string;           // UUID
    email: string;
    name: string;
    createdAt: string;    // ISO 8601
    updatedAt: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;    // 900
  };
}

// 에러
// 400: 유효성 검사 실패
// 409: 이메일 중복
```

##### POST /auth/login

```typescript
// Request
interface LoginRequest {
  email: string;
  password: string;
}

// Response 200
interface LoginResponse {
  user: User;
  tokens: AuthTokens;
}

// 에러
// 400: 유효성 검사 실패
// 401: 잘못된 자격 증명
```

##### POST /auth/refresh

```typescript
// Request
interface RefreshTokenRequest {
  refreshToken: string;
}

// Response 200
interface RefreshTokenResponse {
  tokens: AuthTokens;
}

// 에러
// 401: 유효하지 않거나 만료된 토큰
```

#### React 컴포넌트 예시

```tsx
// components/LoginForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

const loginSchema = z.object({
  email: z.string().email('유효한 이메일을 입력하세요'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const setAuth = useAuthStore((state) => state.setAuth);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const response = await api.post('/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      setAuth(data.user, data.tokens);
      // 대시보드로 이동
      window.location.href = '/dashboard';
    },
    onError: (error: any) => {
      if (error.response?.status === 401) {
        alert('이메일 또는 비밀번호가 올바르지 않습니다.');
      }
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => loginMutation.mutate(data))}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          {...register('email')}
          className="input"
        />
        {errors.email && <span className="error">{errors.email.message}</span>}
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          {...register('password')}
          className="input"
        />
        {errors.password && <span className="error">{errors.password.message}</span>}
      </div>

      <button type="submit" disabled={loginMutation.isPending}>
        {loginMutation.isPending ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
```

---

### 5.2 대시보드 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [Dashboard] | [Playlists] | [Videos] | [Notes] | [Analytics]    |
+------------------------------------------------------------------+
|                                                                  |
|  Welcome back, John!                                             |
|                                                                  |
|  +---------------+  +---------------+  +---------------+         |
|  | Total Videos  |  | Watch Time    |  | Completed     |         |
|  |     127       |  |   45h 30m     |  |     42        |         |
|  +---------------+  +---------------+  +---------------+         |
|                                                                  |
|  +---------------+  +---------------+  +---------------+         |
|  | In Progress   |  | Not Started   |  | Sessions      |         |
|  |     28        |  |     57        |  |     234       |         |
|  +---------------+  +---------------+  +---------------+         |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Learning Streak                                                 |
|  +------------------------------------------------------------+ |
|  | Current: 7 days       | Longest: 21 days      |            | |
|  | Last Active: Today    |                       |            | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Recent Activity                           [View All ->]         |
|  +------------------------------------------------------------+ |
|  | [Thumb] React Tutorial #1    | 85%  | Today    | 15:30    | |
|  | [Thumb] TypeScript Basics    | 100% | Yesterday| 25:00    | |
|  | [Thumb] Node.js Crash Course | 60%  | 2d ago   | 45:00    | |
|  | [Thumb] CSS Grid Layout      | 30%  | 3d ago   | 10:15    | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Top Videos (Most Watched)                 [View All ->]         |
|  +------------------------------------------------------------+ |
|  | [Thumb] Advanced React Patterns  | 2h 30m | 5 sessions    | |
|  | [Thumb] System Design Interview  | 1h 45m | 3 sessions    | |
|  | [Thumb] Docker Deep Dive         | 1h 20m | 4 sessions    | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/auth/me` | 현재 사용자 정보 | ✅ |
| GET | `/analytics/dashboard` | 대시보드 데이터 | ✅ |

#### API 상세

##### GET /auth/me

```typescript
// Response 200
interface GetMeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
}
```

##### GET /analytics/dashboard

```typescript
// Response 200
interface DashboardResponse {
  dashboard: {
    totalVideos: number;              // 총 동영상 수
    totalWatchTime: number;           // 총 시청 시간 (초)
    totalSessions: number;            // 총 세션 수
    averageSessionDuration: number;   // 평균 세션 시간 (초)
    completedVideos: number;          // 완료한 동영상 수
    inProgressVideos: number;         // 진행 중 동영상 수
    notStartedVideos: number;         // 시작 안 한 동영상 수

    recentActivity: Array<{
      videoId: string;
      videoTitle: string;
      watchedAt: string;      // ISO 8601
      duration: number;       // 세션 시간 (초)
      progress: number;       // 진행률 (0-100)
    }>;

    topVideos: Array<{
      videoId: string;
      videoTitle: string;
      watchTime: number;      // 총 시청 시간 (초)
      sessionCount: number;
      completionRate: number; // 완료율 (0-100)
    }>;

    learningStreak: {
      currentStreak: number;  // 현재 연속 일수
      longestStreak: number;  // 최장 연속 일수
      lastActiveDate: string | null;
    };
  };
}
```

#### React 컴포넌트 예시

```tsx
// pages/dashboard.tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export default function Dashboard() {
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then(res => res.data.user),
  });

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then(res => res.data.dashboard),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="dashboard">
      <h1>Welcome back, {user?.name}!</h1>

      {/* Stats Grid */}
      <div className="stats-grid">
        <StatCard title="Total Videos" value={dashboard.totalVideos} />
        <StatCard
          title="Watch Time"
          value={formatDuration(dashboard.totalWatchTime)}
        />
        <StatCard title="Completed" value={dashboard.completedVideos} />
        <StatCard title="In Progress" value={dashboard.inProgressVideos} />
      </div>

      {/* Learning Streak */}
      <LearningStreak streak={dashboard.learningStreak} />

      {/* Recent Activity */}
      <RecentActivityList activities={dashboard.recentActivity} />

      {/* Top Videos */}
      <TopVideosList videos={dashboard.topVideos} />
    </div>
  );
}

// 유틸리티 함수
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
```

---

### 5.3 플레이리스트 목록 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [Dashboard] | [Playlists] | [Videos] | [Notes] | [Analytics]    |
+------------------------------------------------------------------+
|                                                                  |
|  My Playlists                          [+ Import Playlist]       |
|                                                                  |
+------------------------------------------------------------------+
|  Search: [________________________]  [Filter v] [Sort v]         |
+------------------------------------------------------------------+
|                                                                  |
|  +------------------------------------------------------------+ |
|  | +--------+                                                  | |
|  | |        |  React Complete Course 2025                     | |
|  | | [Thumb]|  by Traversy Media                              | |
|  | |        |  42 videos | 12h total | Last sync: 2h ago      | |
|  | +--------+  Status: COMPLETED                              | |
|  |                                                             | |
|  |                                     [Sync] [View] [Delete] | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  +------------------------------------------------------------+ |
|  | +--------+                                                  | |
|  | |        |  TypeScript Deep Dive                           | |
|  | | [Thumb]|  by Net Ninja                                   | |
|  | |        |  28 videos | 8h total | Last sync: 1d ago       | |
|  | +--------+  Status: PENDING                                | |
|  |                                                             | |
|  |                                     [Sync] [View] [Delete] | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  +------------------------------------------------------------+ |
|  | +--------+                                                  | |
|  | |        |  Node.js Masterclass                            | |
|  | | [Thumb]|  by Academind                                   | |
|  | |        |  65 videos | 20h total | Last sync: 3d ago      | |
|  | +--------+  Status: IN_PROGRESS                            | |
|  |                                                             | |
|  |                                     [Sync] [View] [Delete] | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  Pagination: [<] [1] [2] [3] ... [10] [>]                        |
|                                                                  |
+------------------------------------------------------------------+

[Import Playlist Modal]

+------------------------------------------+
|              Import Playlist              |
+------------------------------------------+
|                                          |
|  Paste YouTube Playlist URL or ID:       |
|  +------------------------------------+  |
|  | https://www.youtube.com/playlist?  |  |
|  | list=PLxxxxxx                      |  |
|  +------------------------------------+  |
|                                          |
|  Examples:                               |
|  - https://youtube.com/playlist?list=...  |
|  - PLxxxxxxxxxxxxxxxx                    |
|                                          |
|            [Cancel] [Import]             |
+------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/playlists` | 플레이리스트 목록 | ✅ |
| POST | `/playlists/import` | 플레이리스트 가져오기 | ✅ |
| POST | `/playlists/:id/sync` | 플레이리스트 동기화 | ✅ |
| DELETE | `/playlists/:id` | 플레이리스트 삭제 | ✅ |

#### API 상세

##### GET /playlists

```typescript
// Query Parameters
interface ListPlaylistsQuery {
  filter?: string;                           // 제목/채널명 검색
  sortBy?: 'title' | 'lastSyncedAt' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  limit?: number;                            // 1-100, 기본 20
  offset?: number;                           // 기본 0
}

// Response 200
interface ListPlaylistsResponse {
  playlists: Array<{
    id: string;               // UUID
    youtubeId: string;        // YouTube 플레이리스트 ID
    title: string;
    description: string | null;
    channelId: string;
    channelTitle: string;
    thumbnailUrl: string | null;
    itemCount: number;
    syncStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    lastSyncedAt: string | null;  // ISO 8601
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  limit?: number;
  offset?: number;
}
```

##### POST /playlists/import

```typescript
// Request
interface ImportPlaylistRequest {
  playlistUrl: string;  // YouTube URL 또는 플레이리스트 ID
}

// Response 200
interface ImportPlaylistResponse {
  playlist: Playlist;
}

// 에러
// 400: 잘못된 URL/ID
// 409: 이미 존재하는 플레이리스트
```

##### POST /playlists/:id/sync

```typescript
// Path Parameters
interface SyncPlaylistParams {
  id: string;  // UUID
}

// Response 200
interface SyncResultResponse {
  result: {
    playlistId: string;
    status: string;
    itemsAdded: number;
    itemsRemoved: number;
    itemsReordered: number;
    duration: number;      // 소요 시간 (ms)
    quotaUsed: number;     // 사용된 API 쿼터
    error?: string;
  };
}

// 에러
// 404: 플레이리스트 없음
// 409: 이미 동기화 진행 중
```

##### DELETE /playlists/:id

```typescript
// Path Parameters
interface DeletePlaylistParams {
  id: string;  // UUID
}

// Response 200
interface DeleteResponse {
  message: string;
}

// 에러
// 404: 플레이리스트 없음
```

#### React 컴포넌트 예시

```tsx
// pages/playlists.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export default function PlaylistsPage() {
  const [filter, setFilter] = useState('');
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['playlists', filter],
    queryFn: () => api.get('/playlists', { params: { filter } })
      .then(res => res.data),
  });

  const importMutation = useMutation({
    mutationFn: (playlistUrl: string) =>
      api.post('/playlists/import', { playlistUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setImportModalOpen(false);
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/playlists/${id}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/playlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  return (
    <div className="playlists-page">
      <header className="page-header">
        <h1>My Playlists</h1>
        <button onClick={() => setImportModalOpen(true)}>
          + Import Playlist
        </button>
      </header>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search playlists..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="playlist-list">
        {data?.playlists.map((playlist) => (
          <PlaylistCard
            key={playlist.id}
            playlist={playlist}
            onSync={() => syncMutation.mutate(playlist.id)}
            onDelete={() => deleteMutation.mutate(playlist.id)}
          />
        ))}
      </div>

      <ImportPlaylistModal
        isOpen={isImportModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImport={(url) => importMutation.mutate(url)}
        isLoading={importMutation.isPending}
      />
    </div>
  );
}
```

---

### 5.4 플레이리스트 상세 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [< Back to Playlists]                                            |
+------------------------------------------------------------------+
|                                                                  |
|  +-------------+                                                 |
|  |             |  React Complete Course 2025                     |
|  |   [Large    |  by Traversy Media                             |
|  |  Thumbnail] |  42 videos | 12h 30m total                     |
|  |             |  Last synced: 2 hours ago                      |
|  +-------------+                                   [Sync Now]    |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Progress: [████████████████████░░░░░] 80%                       |
|            34 of 42 videos completed                             |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Videos                          [Search] [Filter: All v]        |
|                                                                  |
+------------------------------------------------------------------+
|  #  | Thumbnail | Title                      | Duration | Status |
+------------------------------------------------------------------+
|  1  | [img]     | 01. Introduction to React  | 10:30    |   ✅   |
|  2  | [img]     | 02. Setting Up Environment | 15:45    |   ✅   |
|  3  | [img]     | 03. Your First Component   | 20:00    |   🔄   |
|  4  | [img]     | 04. Props & State          | 25:30    |   ⬜   |
|  5  | [img]     | 05. Event Handling         | 18:20    |   ⬜   |
|  6  | [img]     | 06. Conditional Rendering  | 12:15    |   ⬜   |
|  7  | [img]     | 07. Lists & Keys           | 22:00    |   ⬜   |
|  8  | [img]     | 08. Forms in React         | 28:45    |   ⬜   |
+------------------------------------------------------------------+
|                                                                  |
|  Pagination: [<] [1] [2] [3] [4] [5] [>]                         |
|                                                                  |
+------------------------------------------------------------------+

Status Icons:
✅ = Completed (100%)
🔄 = In Progress (1-99%)
⬜ = Not Started (0%)
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/playlists/:id` | 플레이리스트 상세 (항목 포함) | ✅ |
| GET | `/analytics/playlists/:id` | 플레이리스트 분석 | ✅ |
| POST | `/playlists/:id/sync` | 플레이리스트 동기화 | ✅ |

#### API 상세

##### GET /playlists/:id

```typescript
// Path Parameters
interface GetPlaylistParams {
  id: string;  // UUID
}

// Response 200
interface GetPlaylistResponse {
  playlist: {
    id: string;
    youtubeId: string;
    title: string;
    description: string | null;
    channelId: string;
    channelTitle: string;
    thumbnailUrl: string | null;
    itemCount: number;
    syncStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    lastSyncedAt: string | null;
    createdAt: string;
    updatedAt: string;

    // 플레이리스트 항목 (동영상 정보 포함)
    items: Array<{
      id: string;
      position: number;      // 순서 (0부터 시작)
      addedAt: string;       // 플레이리스트에 추가된 시간
      video: {
        id: string;
        youtubeId: string;
        title: string;
        description: string | null;
        channelTitle: string;
        duration: number;    // 초 단위
        thumbnailUrls: string;  // JSON 문자열
        viewCount: number;
        publishedAt: string;
      };
    }>;
  };
}
```

##### GET /analytics/playlists/:id

```typescript
// Path Parameters
interface GetPlaylistAnalyticsParams {
  id: string;  // UUID
}

// Response 200
interface PlaylistAnalyticsResponse {
  analytics: {
    playlistId: string;
    playlistTitle: string;
    totalVideos: number;
    watchedVideos: number;      // 최소 1번 시청
    completedVideos: number;    // 80% 이상 시청
    totalWatchTime: number;     // 초 단위
    averageCompletion: number;  // 0-100
    lastActivity: string | null;
  };
}
```

---

### 5.5 동영상 상세 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [< Back to Playlist: React Complete Course 2025]                 |
+------------------------------------------------------------------+
|                                                                  |
|  +------------------------------------------------------------+ |
|  |                                                            | |
|  |                                                            | |
|  |                [YouTube Video Player]                      | |
|  |                   (Embedded iFrame)                        | |
|  |                                                            | |
|  |                                                            | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  React Components Deep Dive                                      |
|  by Traversy Media | 25:30 | 1.2M views | Published: 2025-01-15 |
|                                                                  |
+------------------------------------------------------------------+
|  [Transcript] [Summary] [Notes] [Info]                           |
+------------------------------------------------------------------+

[Transcript Tab]
+------------------------------------------------------------------+
|  Transcript                             Language: [English v]    |
+------------------------------------------------------------------+
|  +------------------------------------------------------------+ |
|  | 0:00   Hello everyone, welcome to this video about React   | |
|  |        components. Today we'll be covering...              | |
|  +------------------------------------------------------------+ |
|  | 0:15   First, let's understand what components are and     | |
|  |        why they're so important in modern web development. | |
|  +------------------------------------------------------------+ |
|  | 0:30   A component is a reusable piece of UI that can      | |
|  |        accept inputs, called props, and return React...    | |
|  +------------------------------------------------------------+ |
|  | ...                                                        | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+

[Summary Tab]
+------------------------------------------------------------------+
|  Summary                    Level: [Brief v]  [Generate Summary] |
+------------------------------------------------------------------+
|  +------------------------------------------------------------+ |
|  | ## Key Points                                              | |
|  |                                                            | |
|  | - React components are reusable building blocks            | |
|  | - Functional components use hooks for state                | |
|  | - Props are read-only, State can be modified               | |
|  | - Component lifecycle managed with useEffect               | |
|  |                                                            | |
|  | ## Summary                                                 | |
|  |                                                            | |
|  | This video covers the fundamentals of React components,    | |
|  | including the difference between functional and class      | |
|  | components, props vs state, and best practices for         | |
|  | component composition.                                     | |
|  |                                                            | |
|  | Generated at: 2025-01-16 10:30:00                          | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+

[Notes Tab]
+------------------------------------------------------------------+
|  My Notes                                        [+ Add Note]    |
+------------------------------------------------------------------+
|  +------------------------------------------------------------+ |
|  | @ 5:30  Props are read-only and cannot be modified        | |
|  |         directly. Use state for mutable data.             | |
|  |         Tags: #react #props                               | |
|  |                                    [Edit] [Delete]        | |
|  +------------------------------------------------------------+ |
|  | @ 10:15 useState hook returns [value, setter] tuple        | |
|  |         Example: const [count, setCount] = useState(0)     | |
|  |         Tags: #react #hooks #useState                     | |
|  |                                    [Edit] [Delete]        | |
|  +------------------------------------------------------------+ |
|  | @ 18:45 useEffect cleanup function prevents memory leaks   | |
|  |         Tags: #react #hooks #useEffect                    | |
|  |                                    [Edit] [Delete]        | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+

[Add Note Modal]
+------------------------------------------+
|              Add Note                     |
+------------------------------------------+
|  Timestamp: [10:30] (current position)   |
|                                          |
|  Content:                                |
|  +------------------------------------+  |
|  | Your note here...                  |  |
|  |                                    |  |
|  |                                    |  |
|  +------------------------------------+  |
|                                          |
|  Tags (comma separated):                 |
|  +------------------------------------+  |
|  | react, hooks, tip                  |  |
|  +------------------------------------+  |
|                                          |
|            [Cancel] [Save Note]          |
+------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/videos/:id` | 동영상 상세 | ✅ |
| GET | `/videos/:id/captions` | 자막 조회 | ✅ |
| GET | `/videos/:id/captions/languages` | 가능한 자막 언어 | ✅ |
| GET | `/videos/:id/summary` | 요약 조회 | ✅ |
| POST | `/videos/:id/summary` | 요약 생성 | ✅ |
| GET | `/videos/:id/notes` | 노트 목록 | ✅ |
| POST | `/videos/:id/notes` | 노트 생성 | ✅ |
| POST | `/analytics/sessions` | 시청 기록 | ✅ |

#### API 상세

##### GET /videos/:id

```typescript
// Path Parameters
interface GetVideoParams {
  id: string;  // UUID
}

// Response 200
interface GetVideoResponse {
  video: {
    id: string;
    youtubeId: string;
    title: string;
    description: string | null;
    channelId: string;
    channelTitle: string;
    duration: number;           // 초 단위
    thumbnailUrls: string;      // JSON 문자열
    viewCount: number;
    likeCount: number;
    commentCount: number;
    publishedAt: string;
    tags: string | null;        // JSON 배열 문자열
    categoryId: string | null;
    language: string | null;
    createdAt: string;
    updatedAt: string;

    // 사용자 시청 상태
    userState: {
      watchStatus: 'UNWATCHED' | 'WATCHING' | 'COMPLETED';
      lastPosition: number;     // 마지막 시청 위치 (초)
      watchCount: number;       // 시청 횟수
      notes: string | null;
      summary: string | null;
      tags: string | null;
      rating: number | null;    // 1-5
      createdAt: string;
      updatedAt: string;
    } | null;
  };
}
```

##### GET /videos/:id/captions

```typescript
// Path Parameters
interface GetCaptionsParams {
  id: string;  // UUID
}

// Query Parameters
interface GetCaptionsQuery {
  language?: string;  // 언어 코드 (기본: 'en')
}

// Response 200
interface CaptionResponse {
  caption: {
    videoId: string;
    language: string;
    fullText: string;           // 전체 자막 텍스트
    segments: Array<{
      text: string;             // 세그먼트 텍스트
      start: number;            // 시작 시간 (초)
      duration: number;         // 길이 (초)
    }>;
  };
}

// 에러
// 404: 자막 없음
```

##### GET /videos/:id/captions/languages

```typescript
// Response 200
interface AvailableLanguagesResponse {
  videoId: string;
  languages: string[];  // ['en', 'ko', 'ja', ...]
}
```

##### GET /videos/:id/summary

```typescript
// Response 200
interface SummaryResponse {
  summary: {
    videoId: string;
    summary: string;
    level: 'brief' | 'detailed' | 'comprehensive';
    language: string;
    generatedAt: string;
  };
}

// 에러
// 404: 요약 없음
```

##### POST /videos/:id/summary

```typescript
// Request
interface GenerateSummaryRequest {
  level?: 'brief' | 'detailed' | 'comprehensive';  // 기본: 'brief'
  language?: string;  // 기본: 'en'
}

// Response 200
interface GenerateSummaryResponse {
  summary: {
    videoId: string;
    summary: string;
    level: string;
    language: string;
    generatedAt: string;
  };
}
```

##### GET /videos/:id/notes

```typescript
// Query Parameters
interface GetVideoNotesQuery {
  tags?: string[];           // 태그 필터
  timestampStart?: number;   // 시작 시간 필터
  timestampEnd?: number;     // 종료 시간 필터
}

// Response 200
interface ListNotesResponse {
  notes: Array<{
    id: string;
    videoId: string;
    timestamp: number;       // 초 단위
    content: string;         // Markdown 지원
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}
```

##### POST /videos/:id/notes

```typescript
// Request
interface CreateNoteRequest {
  timestamp: number;         // 초 단위, 0 이상
  content: string;           // 1-5000자
  tags?: string[];
}

// Response 200
interface CreateNoteResponse {
  note: {
    id: string;
    videoId: string;
    timestamp: number;
    content: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  };
}
```

##### POST /analytics/sessions

```typescript
// Request
interface RecordSessionRequest {
  videoId: string;           // YouTube 동영상 ID
  startPosition: number;     // 시작 위치 (초)
  endPosition: number;       // 종료 위치 (초)
  startTime?: string;        // 세션 시작 시간 (ISO 8601)
  endTime?: string;          // 세션 종료 시간 (ISO 8601)
}

// Response 200
interface RecordSessionResponse {
  session: {
    id: string;
    videoId: string;
    startedAt: string;
    endedAt: string;
    startPos: number;
    endPos: number;
    duration: number;        // 실제 시청 시간 (초)
    createdAt: string;
  };
}
```

---

### 5.6 노트 관리 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [Dashboard] | [Playlists] | [Videos] | [Notes] | [Analytics]    |
+------------------------------------------------------------------+
|                                                                  |
|  My Notes                                        [Export v]      |
|                                                                  |
+------------------------------------------------------------------+
|  Search: [________________________]                              |
|  Tags: [All v]  Video: [All v]                                   |
+------------------------------------------------------------------+
|                                                                  |
|  React Complete Course 2025                                      |
|  +------------------------------------------------------------+ |
|  | @ 5:30  - React Components Deep Dive                       | |
|  |   Props are read-only and cannot be modified directly.     | |
|  |   Use state for mutable data.                              | |
|  |   Tags: #react #props                                      | |
|  |   Created: 2025-01-16 10:30                                | |
|  |                                           [Edit] [Delete]  | |
|  +------------------------------------------------------------+ |
|  | @ 10:15 - React Components Deep Dive                       | |
|  |   useState hook returns [value, setter] tuple              | |
|  |   Example: const [count, setCount] = useState(0)           | |
|  |   Tags: #react #hooks #useState                            | |
|  |   Created: 2025-01-16 11:00                                | |
|  |                                           [Edit] [Delete]  | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  TypeScript Deep Dive                                            |
|  +------------------------------------------------------------+ |
|  | @ 3:00  - Introduction to TypeScript                       | |
|  |   TypeScript provides excellent type inference             | |
|  |   Tags: #typescript #types                                 | |
|  |   Created: 2025-01-15 14:20                                | |
|  |                                           [Edit] [Delete]  | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+

[Export Dropdown]
+--------------------+
| Export as:         |
| - Markdown (.md)   |
| - JSON (.json)     |
| - CSV (.csv)       |
+--------------------+

[Edit Note Modal]
+------------------------------------------+
|              Edit Note                    |
+------------------------------------------+
|  Timestamp: [5:30]                       |
|                                          |
|  Content:                                |
|  +------------------------------------+  |
|  | Props are read-only...             |  |
|  +------------------------------------+  |
|                                          |
|  Tags:                                   |
|  +------------------------------------+  |
|  | react, props                       |  |
|  +------------------------------------+  |
|                                          |
|            [Cancel] [Save]               |
+------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/videos/:id/notes` | 동영상별 노트 목록 | ✅ |
| GET | `/notes/:noteId` | 노트 상세 | ✅ |
| PATCH | `/notes/:noteId` | 노트 수정 | ✅ |
| DELETE | `/notes/:noteId` | 노트 삭제 | ✅ |
| GET | `/notes/export` | 노트 내보내기 | ✅ |

#### API 상세

##### GET /notes/:noteId

```typescript
// Response 200
interface GetNoteResponse {
  note: {
    id: string;
    videoId: string;
    timestamp: number;
    content: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  };
}
```

##### PATCH /notes/:noteId

```typescript
// Request
interface UpdateNoteRequest {
  content?: string;      // 1-5000자
  tags?: string[];
  timestamp?: number;    // 0 이상
}

// Response 200
interface UpdateNoteResponse {
  note: Note;
}
```

##### DELETE /notes/:noteId

```typescript
// Response 200
interface DeleteNoteResponse {
  message: string;
}
```

##### GET /notes/export

```typescript
// Query Parameters
interface ExportNotesQuery {
  videoId?: string;      // 특정 동영상 필터
  tags?: string[];       // 태그 필터
  format?: 'markdown' | 'json' | 'csv';  // 기본: 'markdown'
}

// Response 200
interface ExportNotesResponse {
  content: string;       // 포맷에 따른 내용
  format: string;
}
```

---

### 5.7 분석 대시보드 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [Dashboard] | [Playlists] | [Videos] | [Notes] | [Analytics]    |
+------------------------------------------------------------------+
|                                                                  |
|  Analytics Dashboard                          Period: [Last 30d] |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Overall Statistics                                              |
|  +---------------+  +---------------+  +---------------+         |
|  | Total Videos  |  | Watch Time    |  | Sessions      |         |
|  |     127       |  |   45h 30m     |  |     234       |         |
|  |               |  |               |  |               |         |
|  | +12 this week |  | +5h 20m       |  | +42           |         |
|  +---------------+  +---------------+  +---------------+         |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Learning Streak                                                 |
|  +------------------------------------------------------------+ |
|  |                                                            | |
|  | Current Streak: 7 days                                     | |
|  | [Mon][Tue][Wed][Thu][Fri][Sat][Sun]                        | |
|  |  ■    ■    ■    ■    ■    ■    ■                           | |
|  |                                                            | |
|  | Longest Streak: 21 days                                    | |
|  | Last Active: Today, 10:30 AM                               | |
|  |                                                            | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Playlist Progress                                               |
|  +------------------------------------------------------------+ |
|  | React Course          [████████████░░░░] 80% (34/42)       | |
|  | TypeScript            [██████████░░░░░░] 60% (17/28)       | |
|  | Node.js Mastery       [████████░░░░░░░░] 40% (8/20)        | |
|  | Docker Deep Dive      [████░░░░░░░░░░░░] 25% (5/20)        | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Video Analytics                                                 |
|  +------------------------------------------------------------+ |
|  | Video Title              | Watch Time | Sessions | Status  | |
|  |------------------------------------------------------------|
|  | React Intro              | 2h 30m     | 5        | 100%    | |
|  | TypeScript Functions     | 1h 15m     | 3        | 85%     | |
|  | Node.js Basics           | 45m        | 2        | 60%     | |
|  | Docker Commands          | 30m        | 1        | 40%     | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/analytics/dashboard` | 대시보드 데이터 | ✅ |
| GET | `/analytics/videos/:id` | 동영상별 분석 | ✅ |
| GET | `/analytics/playlists/:id` | 플레이리스트별 분석 | ✅ |

#### API 상세

##### GET /analytics/videos/:id

```typescript
// Path Parameters: YouTube 동영상 ID

// Response 200
interface VideoAnalyticsResponse {
  analytics: {
    videoId: string;
    videoTitle: string;
    totalDuration: number;        // 동영상 총 길이 (초)
    totalWatchTime: number;       // 총 시청 시간 (초)
    completionPercentage: number; // 완료율 (0-100)
    watchCount: number;           // 시청 세션 수
    lastWatchedAt: string | null;
    firstWatchedAt: string | null;
    averageSessionDuration: number; // 평균 세션 시간 (초)
    rewatchCount: number;         // 재시청 횟수
  };
}
```

---

### 5.8 설정/할당량 페이지

#### 와이어프레임

```
+------------------------------------------------------------------+
| [Logo] Insighta                           [User Avatar] [Logout] |
+------------------------------------------------------------------+
| [Dashboard] | [Playlists] | [Videos] | [Notes] | [Settings]     |
+------------------------------------------------------------------+
|                                                                  |
|  Settings                                                        |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Profile                                                         |
|  +------------------------------------------------------------+ |
|  | Name: John Doe                                 [Edit]      | |
|  | Email: john@example.com                                    | |
|  | Member since: January 15, 2025                             | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  YouTube API Quota                                               |
|  +------------------------------------------------------------+ |
|  |                                                            | |
|  | Daily Usage                                                | |
|  | [████████████████████░░░░░░░░░░] 8,500 / 10,000 units      | |
|  |                                                            | |
|  | Remaining: 1,500 units (15%)                               | |
|  | Resets at: 2025-12-20 00:00:00 UTC                         | |
|  |                                                            | |
|  | Cost per operation:                                        | |
|  | - Playlist list: 1 unit                                    | |
|  | - Playlist items: 1 unit                                   | |
|  | - Video details: 1 unit                                    | |
|  | - Search: 100 units                                        | |
|  |                                                            | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Sync Schedules                                                  |
|  +------------------------------------------------------------+ |
|  | Playlist              | Interval  | Status    | Actions   | |
|  |------------------------------------------------------------|
|  | React Course          | 6 hours   | Enabled   | [Edit][x] | |
|  | TypeScript            | 12 hours  | Disabled  | [Edit][x] | |
|  | Node.js               | 24 hours  | Enabled   | [Edit][x] | |
|  +------------------------------------------------------------+ |
|  |                              [+ Add Schedule]              | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Rate Limits                                                     |
|  +------------------------------------------------------------+ |
|  | Endpoint              | Limit        | Window              | |
|  |------------------------------------------------------------|
|  | /auth/login           | 10 requests  | 1 minute            | |
|  | /auth/register        | 5 requests   | 1 minute            | |
|  | /playlists/import     | 20 requests  | 1 hour              | |
|  | /playlists/:id/sync   | 30 requests  | 1 hour              | |
|  | /videos/:id/summary   | 10 requests  | 1 hour              | |
|  | General API           | 200 requests | 1 minute            | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
|                                                                  |
|  Actions                                                         |
|  +------------------------------------------------------------+ |
|  | [Change Password]  [Delete Account]  [Logout]              | |
|  +------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

#### 관련 API

| 메서드 | 엔드포인트 | 설명 | 인증 |
|--------|-----------|------|------|
| GET | `/auth/me` | 현재 사용자 정보 | ✅ |
| GET | `/quota/usage` | 할당량 사용량 | ✅ |
| GET | `/quota/limits` | 할당량 제한 | ✅ |
| GET | `/sync/schedule` | 스케줄 목록 | ✅ |
| POST | `/sync/schedule` | 스케줄 생성 | ✅ |
| PATCH | `/sync/schedule/:id` | 스케줄 수정 | ✅ |
| DELETE | `/sync/schedule/:id` | 스케줄 삭제 | ✅ |
| POST | `/auth/logout` | 로그아웃 | ✅ |

#### API 상세

##### GET /quota/usage

```typescript
// Response 200
interface QuotaUsageResponse {
  quota: {
    date: string;         // 현재 날짜 (ISO 8601)
    used: number;         // 사용한 단위
    limit: number;        // 일일 제한 (기본: 10000)
    remaining: number;    // 남은 단위
    percentage: number;   // 사용률 (0-100)
    resetAt: string;      // 리셋 시간 (ISO 8601)
  };
}
```

##### GET /quota/limits

```typescript
// Response 200
interface QuotaLimitsResponse {
  limits: {
    youtube: {
      dailyLimit: number;     // 일일 한도 (10000)
      quotaCosts: {
        'playlists.list': number;      // 1
        'playlistItems.list': number;  // 1
        'videos.list': number;         // 1
        'search.list': number;         // 100
        // ...
      };
    };
    rateLimits: Array<{
      endpoint: string;       // '/api/v1/auth/login'
      max: number;            // 10
      timeWindow: string;     // '1 minute'
      timeWindowMs: number;   // 60000
    }>;
  };
}
```

##### GET /sync/schedule

```typescript
// Response 200
interface GetSchedulesResponse {
  schedules: Array<{
    id: string;
    playlistId: string;
    interval: number;        // ms (최소 60000)
    enabled: boolean;
    lastRun: string | null;
    nextRun: string;
    retryCount: number;
    maxRetries: number;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

##### POST /sync/schedule

```typescript
// Request
interface CreateScheduleRequest {
  playlistId: string;        // UUID
  interval: number;          // ms (최소 60000 = 1분)
  enabled?: boolean;         // 기본: true
}

// Response 200
interface CreateScheduleResponse {
  schedule: Schedule;
}

// 에러
// 409: 이미 스케줄이 존재함
```

##### PATCH /sync/schedule/:id

```typescript
// Request
interface UpdateScheduleRequest {
  interval?: number;         // ms
  enabled?: boolean;
}

// Response 200
interface UpdateScheduleResponse {
  schedule: Schedule;
}
```

##### DELETE /sync/schedule/:id

```typescript
// Response 200
interface DeleteScheduleResponse {
  message: string;
}
```

##### POST /auth/logout

```typescript
// Request
interface LogoutRequest {
  refreshToken: string;
}

// Response 200
interface LogoutResponse {
  message: string;
}
```

---

## 6. 전체 API 레퍼런스 (42개)

### 6.1 Auth API (5개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 1 | POST | `/auth/register` | 회원가입 | ❌ |
| 2 | POST | `/auth/login` | 로그인 | ❌ |
| 3 | POST | `/auth/refresh` | 토큰 갱신 | ❌ |
| 4 | POST | `/auth/logout` | 로그아웃 | ✅ |
| 5 | GET | `/auth/me` | 현재 사용자 정보 | ✅ |

### 6.2 Playlists API (5개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 6 | GET | `/playlists` | 플레이리스트 목록 | ✅ |
| 7 | POST | `/playlists/import` | 플레이리스트 가져오기 | ✅ |
| 8 | GET | `/playlists/:id` | 플레이리스트 상세 | ✅ |
| 9 | POST | `/playlists/:id/sync` | 플레이리스트 동기화 | ✅ |
| 10 | DELETE | `/playlists/:id` | 플레이리스트 삭제 | ✅ |

### 6.3 Videos API (7개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 11 | GET | `/videos` | 동영상 목록 | ✅ |
| 12 | GET | `/videos/:id` | 동영상 상세 | ✅ |
| 13 | GET | `/videos/:id/captions` | 자막 조회 | ✅ |
| 14 | GET | `/videos/:id/captions/languages` | 자막 언어 목록 | ✅ |
| 15 | GET | `/videos/:id/summary` | 요약 조회 | ✅ |
| 16 | POST | `/videos/:id/summary` | 요약 생성 | ✅ |
| 17 | GET | `/videos/:id/notes` | 동영상 노트 목록 | ✅ |

### 6.4 Notes API (6개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 18 | POST | `/videos/:id/notes` | 노트 생성 | ✅ |
| 19 | GET | `/notes/:noteId` | 노트 상세 | ✅ |
| 20 | PATCH | `/notes/:noteId` | 노트 수정 | ✅ |
| 21 | DELETE | `/notes/:noteId` | 노트 삭제 | ✅ |
| 22 | GET | `/notes/export` | 노트 내보내기 | ✅ |

### 6.5 Sync API (8개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 23 | GET | `/sync/status` | 전체 동기화 상태 | ✅ |
| 24 | GET | `/sync/status/:playlistId` | 개별 동기화 상태 | ✅ |
| 25 | GET | `/sync/history` | 동기화 이력 | ✅ |
| 26 | GET | `/sync/history/:syncId` | 동기화 이력 상세 | ✅ |
| 27 | GET | `/sync/schedule` | 스케줄 목록 | ✅ |
| 28 | POST | `/sync/schedule` | 스케줄 생성 | ✅ |
| 29 | PATCH | `/sync/schedule/:id` | 스케줄 수정 | ✅ |
| 30 | DELETE | `/sync/schedule/:id` | 스케줄 삭제 | ✅ |

### 6.6 Analytics API (4개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 31 | GET | `/analytics/dashboard` | 대시보드 데이터 | ✅ |
| 32 | GET | `/analytics/videos/:id` | 동영상 분석 | ✅ |
| 33 | GET | `/analytics/playlists/:id` | 플레이리스트 분석 | ✅ |
| 34 | POST | `/analytics/sessions` | 시청 세션 기록 | ✅ |

### 6.7 Quota API (2개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 35 | GET | `/quota/usage` | 할당량 사용량 | ✅ |
| 36 | GET | `/quota/limits` | 할당량 제한 | ✅ |

### 6.8 Health API (2개)

| # | 메서드 | 엔드포인트 | 설명 | 인증 |
|---|--------|-----------|------|------|
| 37 | GET | `/health` | 헬스 체크 | ❌ |
| 38 | GET | `/health/ready` | 레디니스 체크 | ❌ |

### 6.9 Videos - Additional (4개 - 6.3에 포함된 것 제외)

> 참고: Videos API의 notes 엔드포인트는 Notes API에 포함됨

### 6.10 전체 API 상세 - Sync API

##### GET /sync/status

```typescript
// Response 200
interface GetSyncStatusesResponse {
  statuses: Array<{
    playlistId: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    lastSyncedAt: string | null;
    itemCount: number;
    isRunning: boolean;
  }>;
}
```

##### GET /sync/status/:playlistId

```typescript
// Response 200
interface GetPlaylistSyncStatusResponse {
  status: {
    playlistId: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    lastSyncedAt: string | null;
    itemCount: number;
    isRunning: boolean;
  };
}
```

##### GET /sync/history

```typescript
// Query Parameters
interface GetSyncHistoryQuery {
  playlistId?: string;       // UUID
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  page?: number;             // 기본: 1
  limit?: number;            // 기본: 20, 최대: 100
}

// Response 200
interface GetSyncHistoryResponse {
  history: Array<{
    id: string;
    playlistId: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    duration: number | null;   // ms
    itemsAdded: number;
    itemsRemoved: number;
    itemsReordered: number;
    quotaUsed: number;
    errorMessage: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

##### GET /sync/history/:syncId

```typescript
// Response 200
interface GetSyncDetailsResponse {
  sync: {
    id: string;
    playlistId: string;
    playlistTitle: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    duration: number | null;
    itemsAdded: number;
    itemsRemoved: number;
    itemsReordered: number;
    quotaUsed: number;
    errorMessage: string | null;
  };
}
```

### 6.11 전체 API 상세 - Videos API (추가)

##### GET /videos

```typescript
// Query Parameters
interface ListVideosQuery {
  playlistId?: string;       // UUID - 플레이리스트 필터
  search?: string;           // 제목/설명 검색
  tags?: string[];           // 태그 필터
  status?: 'UNWATCHED' | 'WATCHING' | 'COMPLETED';  // 시청 상태
  page?: number;             // 기본: 1
  limit?: number;            // 기본: 20, 최대: 100
  sortBy?: 'title' | 'publishedAt' | 'duration' | 'viewCount';
  sortOrder?: 'asc' | 'desc';  // 기본: 'desc'
}

// Response 200
interface ListVideosResponse {
  videos: Array<{
    id: string;
    youtubeId: string;
    title: string;
    description: string | null;
    channelId: string;
    channelTitle: string;
    duration: number;
    thumbnailUrls: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    publishedAt: string;
    tags: string | null;
    categoryId: string | null;
    language: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## 7. 공통 컴포넌트 설계

### 7.1 컴포넌트 계층 구조

```
src/
├── components/
│   ├── ui/                    # 기본 UI 컴포넌트
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Spinner.tsx
│   │   ├── Toast.tsx
│   │   └── Pagination.tsx
│   │
│   ├── layout/                # 레이아웃 컴포넌트
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Footer.tsx
│   │   └── PageLayout.tsx
│   │
│   ├── auth/                  # 인증 관련
│   │   ├── LoginForm.tsx
│   │   ├── RegisterForm.tsx
│   │   └── AuthGuard.tsx
│   │
│   ├── playlist/              # 플레이리스트 관련
│   │   ├── PlaylistCard.tsx
│   │   ├── PlaylistList.tsx
│   │   ├── ImportPlaylistModal.tsx
│   │   └── PlaylistProgress.tsx
│   │
│   ├── video/                 # 동영상 관련
│   │   ├── VideoCard.tsx
│   │   ├── VideoPlayer.tsx
│   │   ├── TranscriptPanel.tsx
│   │   ├── SummaryPanel.tsx
│   │   └── VideoInfo.tsx
│   │
│   ├── note/                  # 노트 관련
│   │   ├── NoteCard.tsx
│   │   ├── NoteList.tsx
│   │   ├── NoteEditor.tsx
│   │   └── NoteExport.tsx
│   │
│   ├── analytics/             # 분석 관련
│   │   ├── StatCard.tsx
│   │   ├── ProgressBar.tsx
│   │   ├── LearningStreak.tsx
│   │   ├── ActivityList.tsx
│   │   └── ChartCard.tsx
│   │
│   └── settings/              # 설정 관련
│       ├── ProfileSection.tsx
│       ├── QuotaDisplay.tsx
│       ├── ScheduleList.tsx
│       └── RateLimitInfo.tsx
```

### 7.2 주요 컴포넌트 인터페이스

```typescript
// ui/Button.tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
}

// ui/Card.tsx
interface CardProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

// ui/Modal.tsx
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
}

// playlist/PlaylistCard.tsx
interface PlaylistCardProps {
  playlist: Playlist;
  onSync: () => void;
  onDelete: () => void;
  isLoading?: boolean;
}

// video/VideoPlayer.tsx
interface VideoPlayerProps {
  videoId: string;           // YouTube 동영상 ID
  startPosition?: number;    // 시작 위치 (초)
  onProgress?: (position: number) => void;
  onEnded?: () => void;
}

// note/NoteEditor.tsx
interface NoteEditorProps {
  videoId: string;
  timestamp: number;
  initialContent?: string;
  initialTags?: string[];
  onSave: (note: CreateNoteRequest) => void;
  onCancel: () => void;
}

// analytics/StatCard.tsx
interface StatCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    trend: 'up' | 'down' | 'neutral';
  };
  icon?: React.ReactNode;
}
```

---

## 8. 상태 관리 패턴

### 8.1 Zustand 스토어 구조

```typescript
// stores/auth.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;

  // Actions
  setAuth: (user: User, tokens: AuthTokens) => void;
  clearAuth: () => void;
  updateTokens: (tokens: AuthTokens) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,

      setAuth: (user, tokens) => set({
        user,
        tokens,
        isAuthenticated: true,
      }),

      clearAuth: () => set({
        user: null,
        tokens: null,
        isAuthenticated: false,
      }),

      updateTokens: (tokens) => set({ tokens }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        tokens: state.tokens,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
```

### 8.2 TanStack Query 패턴

```typescript
// hooks/useQueries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Query Keys
export const queryKeys = {
  user: ['user'] as const,
  dashboard: ['dashboard'] as const,
  playlists: (filter?: string) => ['playlists', filter] as const,
  playlist: (id: string) => ['playlist', id] as const,
  videos: (params?: any) => ['videos', params] as const,
  video: (id: string) => ['video', id] as const,
  captions: (videoId: string, lang: string) => ['captions', videoId, lang] as const,
  notes: (videoId: string) => ['notes', videoId] as const,
  syncStatus: () => ['sync', 'status'] as const,
  schedules: () => ['sync', 'schedules'] as const,
  quota: () => ['quota'] as const,
};

// Playlist Hooks
export function usePlaylists(filter?: string) {
  return useQuery({
    queryKey: queryKeys.playlists(filter),
    queryFn: () => api.get('/playlists', { params: { filter } })
      .then(res => res.data),
  });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: queryKeys.playlist(id),
    queryFn: () => api.get(`/playlists/${id}`).then(res => res.data.playlist),
    enabled: !!id,
  });
}

export function useImportPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (playlistUrl: string) =>
      api.post('/playlists/import', { playlistUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useSyncPlaylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.post(`/playlists/${id}/sync`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.playlist(id) });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

// Video Hooks
export function useVideo(id: string) {
  return useQuery({
    queryKey: queryKeys.video(id),
    queryFn: () => api.get(`/videos/${id}`).then(res => res.data.video),
    enabled: !!id,
  });
}

export function useCaptions(videoId: string, language: string = 'en') {
  return useQuery({
    queryKey: queryKeys.captions(videoId, language),
    queryFn: () => api.get(`/videos/${videoId}/captions`, { params: { language } })
      .then(res => res.data.caption),
    enabled: !!videoId,
  });
}

// Note Hooks
export function useVideoNotes(videoId: string) {
  return useQuery({
    queryKey: queryKeys.notes(videoId),
    queryFn: () => api.get(`/videos/${videoId}/notes`).then(res => res.data),
    enabled: !!videoId,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ videoId, ...data }: { videoId: string } & CreateNoteRequest) =>
      api.post(`/videos/${videoId}/notes`, data),
    onSuccess: (_, { videoId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(videoId) });
    },
  });
}
```

---

## 9. 에러 처리 패턴

### 9.1 에러 타입 정의

```typescript
// types/error.ts
export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface APIErrorResponse {
  error: APIError;
}

// 에러 코드 상수
export const ErrorCodes = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  EMAIL_EXISTS: 'EMAIL_EXISTS',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resource
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',

  // Rate Limit
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
```

### 9.2 에러 처리 유틸리티

```typescript
// lib/error.ts
import { AxiosError } from 'axios';
import { APIErrorResponse } from '@/types/error';

export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as APIErrorResponse;
    return data?.error?.message || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred';
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 401;
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 404;
}

export function isRateLimitError(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 429;
}

export function isValidationError(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 400;
}
```

### 9.3 전역 에러 핸들러

```typescript
// components/ErrorBoundary.tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // 에러 로깅 서비스로 전송
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-page">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### 9.4 Toast 알림 시스템

```typescript
// hooks/useToast.ts
import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = Math.random().toString(36).slice(2);
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));

    // 자동 제거
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, toast.duration || 5000);
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

// 편의 함수
export function useToast() {
  const addToast = useToastStore((state) => state.addToast);

  return {
    success: (message: string) => addToast({ type: 'success', message }),
    error: (message: string) => addToast({ type: 'error', message }),
    warning: (message: string) => addToast({ type: 'warning', message }),
    info: (message: string) => addToast({ type: 'info', message }),
  };
}
```

---

## 10. 코드 예제

### 10.1 완전한 페이지 예시: 플레이리스트 목록

```tsx
// pages/playlists/index.tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/hooks/useToast';
import api from '@/lib/api';

import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PlaylistCard } from '@/components/playlist/PlaylistCard';
import { Spinner } from '@/components/ui/Spinner';
import { Pagination } from '@/components/ui/Pagination';

const ITEMS_PER_PAGE = 10;

export default function PlaylistsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');

  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();
  const toast = useToast();

  // 플레이리스트 목록 조회
  const { data, isLoading, error } = useQuery({
    queryKey: ['playlists', debouncedSearch, page],
    queryFn: () => api.get('/playlists', {
      params: {
        filter: debouncedSearch || undefined,
        limit: ITEMS_PER_PAGE,
        offset: (page - 1) * ITEMS_PER_PAGE,
      },
    }).then(res => res.data),
  });

  // 플레이리스트 가져오기
  const importMutation = useMutation({
    mutationFn: (url: string) => api.post('/playlists/import', { playlistUrl: url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setImportModalOpen(false);
      setPlaylistUrl('');
      toast.success('Playlist imported successfully!');
    },
    onError: (error: any) => {
      const message = error.response?.data?.error?.message || 'Failed to import playlist';
      toast.error(message);
    },
  });

  // 플레이리스트 동기화
  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/playlists/${id}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Sync started');
    },
    onError: () => {
      toast.error('Failed to start sync');
    },
  });

  // 플레이리스트 삭제
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/playlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Playlist deleted');
    },
    onError: () => {
      toast.error('Failed to delete playlist');
    },
  });

  const handleImport = () => {
    if (!playlistUrl.trim()) {
      toast.error('Please enter a playlist URL');
      return;
    }
    importMutation.mutate(playlistUrl);
  };

  const totalPages = data ? Math.ceil(data.total / ITEMS_PER_PAGE) : 0;

  return (
    <PageLayout title="My Playlists">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">My Playlists</h1>
        <Button onClick={() => setImportModalOpen(true)}>
          + Import Playlist
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <Input
          placeholder="Search playlists..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1); // 검색 시 첫 페이지로
          }}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-500">
          Failed to load playlists. Please try again.
        </div>
      ) : data?.playlists.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No playlists found. Import your first playlist!
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {data?.playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                onSync={() => syncMutation.mutate(playlist.id)}
                onDelete={() => {
                  if (confirm('Are you sure you want to delete this playlist?')) {
                    deleteMutation.mutate(playlist.id);
                  }
                }}
                isLoading={
                  syncMutation.isPending && syncMutation.variables === playlist.id
                }
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}

      {/* Import Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setPlaylistUrl('');
        }}
        title="Import Playlist"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              YouTube Playlist URL or ID
            </label>
            <Input
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=..."
            />
            <p className="mt-1 text-sm text-gray-500">
              Paste a YouTube playlist URL or playlist ID (e.g., PLxxxxxx)
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setImportModalOpen(false);
                setPlaylistUrl('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              isLoading={importMutation.isPending}
            >
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}
```

### 10.2 API 클라이언트 설정

```typescript
// lib/api.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30초
});

// 토큰 갱신 중인지 추적
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

// 요청 인터셉터
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const { tokens } = useAuthStore.getState();

    if (tokens?.accessToken) {
      config.headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// 응답 인터셉터
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 401 에러 && 재시도 아닌 경우
    if (error.response?.status === 401 && !originalRequest._retry) {
      const { tokens, updateTokens, clearAuth } = useAuthStore.getState();

      if (!tokens?.refreshToken) {
        clearAuth();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // 토큰 갱신 중이면 대기
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken: tokens.refreshToken,
        });

        const newTokens = response.data.tokens;
        updateTokens(newTokens);
        onTokenRefreshed(newTokens.accessToken);

        originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        clearAuth();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
```

---

## 부록: 유틸리티 함수

### 시간 포맷팅

```typescript
// lib/format.ts

/**
 * 초를 HH:MM:SS 형식으로 변환
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * 초를 "Xh Ym" 형식으로 변환
 */
export function formatWatchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * 상대적 시간 표시 (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const target = new Date(date);
  const diffMs = now.getTime() - target.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return diffDays === 1 ? 'Yesterday' : `${diffDays}d ago`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ago`;
  }
  if (diffMins > 0) {
    return `${diffMins}m ago`;
  }
  return 'Just now';
}
```

### 썸네일 파싱

```typescript
/**
 * YouTube 썸네일 URL JSON에서 최적 URL 추출
 */
export function parseThumbnailUrl(
  thumbnailsJson: string,
  quality: 'default' | 'medium' | 'high' | 'maxres' = 'medium'
): string {
  try {
    const thumbnails = JSON.parse(thumbnailsJson);
    return thumbnails[quality]?.url || thumbnails.default?.url || '';
  } catch {
    return '';
  }
}
```

---

## 문서 정보

- **작성일**: 2025-12-19
- **작성자**: James Kim (admin@insighta.one)
- **프로젝트**: Insighta (Insighta)
- **버전**: 2.0.0
- **API 버전**: v1
- **총 API 엔드포인트**: 42개

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 2.0.0 | 2025-12-19 | 최초 작성 - 전체 42개 API 문서화 |

