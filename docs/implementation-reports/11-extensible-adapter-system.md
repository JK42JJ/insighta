# Implementation Report: Extensible Adapter System

**Date**: 2025-12-22
**Phase**: 5.2
**Status**: Complete

---

## Overview

Insighta 프로젝트에 확장 가능한 플러그인 기반 어댑터 시스템을 구축했습니다. 이 시스템을 통해 YouTube 외에 다양한 데이터 소스 (Notion, Google Drive, RSS, Markdown, PDF 등)를 통합할 수 있는 아키텍처를 마련했습니다.

### Goals

1. **플러그인 패턴**: 새 어댑터 추가 시 코어 코드 수정 불필요
2. **자동 등록**: 데코레이터/Factory 기반 어댑터 등록
3. **Subagent 위임**: `adapter-dev` subagent가 어댑터 개발 자율 수행
4. **자동화 도구**: 스캐폴딩 스크립트, skill, command 제공

---

## Architecture

### 어댑터 카테고리 구조

```
src/adapters/
├── core/                          # 공통 인터페이스 및 유틸리티
│   ├── index.ts                   # Core exports
│   └── base-adapter.ts            # BaseAdapter 추상 클래스
├── oauth/                         # OAuth 기반 서비스
│   ├── base-oauth-adapter.ts      # OAuth 베이스 클래스
│   └── youtube/                   # YouTube 어댑터 (기존)
├── feed/                          # 피드 기반 서비스
│   ├── base-feed-adapter.ts       # Feed 베이스 클래스
│   └── rss/                       # RSS 어댑터 (예정)
└── file/                          # 파일 파서
    ├── base-file-adapter.ts       # File 베이스 클래스
    ├── markdown/                  # Markdown 어댑터 (예정)
    └── pdf/                       # PDF 어댑터 (예정)
```

### Base 클래스 계층

```
DataSourceAdapter (Interface)
        ↓
   BaseAdapter (Abstract)
   ├── 공통 캐싱
   ├── 쿼터 관리
   ├── 에러 처리
   └── 메트릭 수집
        ↓
   ┌────────────────┬────────────────┬────────────────┐
   ↓                ↓                ↓
BaseOAuthAdapter  BaseFeedAdapter  BaseFileAdapter
   ├── OAuth 설정     ├── 피드 파싱      ├── 파일 파싱
   ├── 토큰 교환      ├── 아이템 매핑    ├── 확장자 지원
   └── 토큰 갱신      └── 피드 검증      └── 제목 추출
```

---

## Implementation Details

### 1. SourceType 확장

`src/adapters/DataSourceAdapter.ts`:

```typescript
export type SourceType =
  | 'youtube' | 'notion' | 'linkedin' | 'file' | 'google_drive'
  | 'vimeo' | 'spotify'
  // Feed adapters
  | 'rss'
  // File parsers
  | 'markdown' | 'pdf' | 'docx' | 'pptx' | 'txt'
  | string;
```

### 2. BaseAdapter 추상 클래스

`src/adapters/core/base-adapter.ts`:

- **캐싱**: `getCached<T>()`, `setCache()`, `clearCache()`
- **쿼터 관리**: `checkQuota()`, `addQuotaCost()`
- **에러 처리**: `AdapterError` 통합
- **로깅**: Winston 로거 통합
- **검증**: 컬렉션/콘텐츠 검증 헬퍼

### 3. BaseOAuthAdapter

`src/adapters/oauth/base-oauth-adapter.ts`:

```typescript
abstract class BaseOAuthAdapter extends BaseAdapter {
  abstract getOAuthConfig(): OAuthConfig;
  abstract exchangeCodeForTokens(code: string): Promise<OAuthTokens>;
  abstract refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

  // 공통 구현
  async isTokenExpired(tokens: OAuthTokens): Promise<boolean>;
  getAuthorizationUrl(state: string, scopes?: string[]): string;
}
```

### 4. BaseFeedAdapter

`src/adapters/feed/base-feed-adapter.ts`:

```typescript
abstract class BaseFeedAdapter extends BaseAdapter {
  abstract parseFeed(feedContent: string): Promise<FeedParseResult>;
  abstract mapFeedItemToContentItem(item: FeedItem): ContentItem;

  // 공통 구현
  async fetchFeed(url: string): Promise<string>;
  async fetchCollectionItems(collectionId: string): Promise<ContentItem[]>;
}
```

### 5. BaseFileAdapter

`src/adapters/file/base-file-adapter.ts`:

```typescript
abstract class BaseFileAdapter extends BaseAdapter {
  abstract getSupportedExtensions(): string[];
  abstract parseFile(content: Buffer, filename: string): Promise<ParsedFile>;
  abstract extractTitle(parsed: ParsedFile): string;

  // 공통 구현
  canHandle(filename: string): boolean;
  async processFile(filepath: string): Promise<ContentItem>;
}
```

---

## Automation Tools

### 1. Scaffolding Script

`scripts/create-adapter.ts`:

```bash
# OAuth 어댑터 생성
npm run create:adapter -- --name notion --category oauth

# Feed 어댑터 생성
npm run create:adapter -- --name rss --category feed

# File 어댑터 생성
npm run create:adapter -- --name markdown --category file
```

**생성되는 파일**:
```
src/adapters/{category}/{name}/
├── index.ts           # 메인 어댑터 클래스
├── types.ts           # 소스별 타입
├── parser.ts          # 파싱 로직 (file 카테고리)
└── __tests__/
    └── index.test.ts  # MSW 기반 테스트
```

### 2. adapter-patterns Skill

`.claude/skills/adapter-patterns/SKILL.md`:

- Base 클래스 선택 가이드
- 필수 구현 메서드 목록
- JSON Schema 패턴 (Frontend 폼 자동 생성)
- 에러 처리 패턴 (`AdapterError` 사용)
- 캐싱 전략
- 쿼터 관리 패턴
- MSW 기반 테스트 패턴
- 권장 라이브러리 목록

### 3. create-adapter Command

`.claude/commands/create-adapter.md`:

```yaml
---
name: create-adapter
description: 새 어댑터 스캐폴딩 생성
---

Usage: /create-adapter <name> <category>
Categories: oauth | feed | file
```

---

## adapter-dev Subagent

`.claude/agents/adapter-dev.md`:

### 역할
- 데이터 소스 어댑터 개발 전문가
- OAuth, Feed, File 카테고리별 구현 지원
- MSW 기반 테스트 작성
- JSON Schema 정의

### 지원 어댑터

| 카테고리 | 어댑터 | 상태 |
|---------|-------|------|
| OAuth | YouTube | ✅ 구현됨 |
| OAuth | Notion | 🔜 예정 |
| OAuth | Google Drive | 🔜 예정 |
| OAuth | LinkedIn | 🔜 예정 |
| Feed | RSS | 🔜 예정 |
| File | Markdown | 🔜 예정 |
| File | PDF | 🔜 예정 |
| File | DOCX | 🔜 예정 |
| File | PPTX | 🔜 예정 |
| File | TXT | 🔜 예정 |

### 위임 규칙 (CLAUDE.md)

```markdown
| 작업 유형 | 위임 대상 | 비고 |
|----------|----------|------|
| 새 어댑터 구현 | `adapter-dev` | OAuth, Feed, File 카테고리 |
| 어댑터 테스트 작성 | `adapter-dev` | MSW 기반 통합 테스트 |
| JSON Schema 정의 | `adapter-dev` | Frontend 폼 자동 생성용 |
| 어댑터 버그 수정 | `adapter-dev` | 기존 어댑터 유지보수 |
| 어댑터 기능 확장 | `adapter-dev` | 기존 어댑터 기능 추가 |
```

---

## JSON Schema for Frontend

어댑터의 `configSchema`를 통해 Frontend에서 자동으로 설정 폼을 생성할 수 있습니다:

```typescript
getAdapterInfo(): AdapterInfo {
  return {
    // ...
    configSchema: {
      type: 'object',
      properties: {
        feedUrl: {
          type: 'string',
          format: 'uri',
          title: 'Feed URL',
          description: 'RSS/Atom feed URL to sync',
        },
        refreshInterval: {
          type: 'number',
          title: 'Refresh Interval',
          default: 3600,
          minimum: 60,
          maximum: 86400,
        },
        includeContent: {
          type: 'boolean',
          title: 'Include Full Content',
          default: true,
        },
      },
      required: ['feedUrl'],
    },
  };
}
```

| Schema Type | Frontend Component |
|-------------|-------------------|
| `string` | Text Input |
| `string` + `format: 'uri'` | URL Input with validation |
| `number` | Number Input |
| `boolean` | Toggle/Checkbox |
| `string` + `enum` | Select/Dropdown |
| `array` | Multi-select or List |

---

## Error Handling

모든 어댑터는 `AdapterError`를 사용하여 일관된 에러 처리를 수행합니다:

```typescript
throw new AdapterError(
  AdapterErrorCode.AUTH_FAILED,
  'OAuth authentication failed',
  this.sourceType,
  originalError,
  { statusCode: 401 }
);
```

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `AUTH_FAILED` | 인증 실패 | 401 |
| `AUTH_EXPIRED` | 토큰 만료 | 401 |
| `NOT_FOUND` | 리소스 없음 | 404 |
| `RATE_LIMITED` | Rate limit 초과 | 429 |
| `QUOTA_EXCEEDED` | 할당량 초과 | 429 |
| `NETWORK_ERROR` | 네트워크 오류 | 5xx |
| `INVALID_INPUT` | 잘못된 입력 | 400 |
| `INTERNAL_ERROR` | 내부 오류 | 500 |

---

## Testing Pattern

MSW (Mock Service Worker)를 사용한 통합 테스트:

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('https://api.example.com/items', () => {
    return HttpResponse.json({
      items: [{ id: '1', title: 'Test' }],
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('should fetch collection items', async () => {
  const adapter = new MyAdapter(config);
  const items = await adapter.fetchCollectionItems('collection-id');
  expect(items).toHaveLength(1);
});
```

---

## Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `src/adapters/DataSourceAdapter.ts` | Modified | SourceType 확장 |
| `src/adapters/core/index.ts` | Created | Core exports |
| `src/adapters/core/base-adapter.ts` | Created | BaseAdapter 추상 클래스 |
| `src/adapters/oauth/base-oauth-adapter.ts` | Created | OAuth 베이스 클래스 |
| `src/adapters/feed/base-feed-adapter.ts` | Created | Feed 베이스 클래스 |
| `src/adapters/file/base-file-adapter.ts` | Created | File 베이스 클래스 |
| `.claude/agents/adapter-dev.md` | Modified | Subagent 대폭 강화 |
| `.claude/skills/adapter-patterns/SKILL.md` | Created | 어댑터 패턴 skill |
| `.claude/commands/create-adapter.md` | Created | 스캐폴딩 명령 |
| `scripts/create-adapter.ts` | Created | 스캐폴딩 스크립트 |
| `CLAUDE.md` | Modified | 위임 규칙 추가 |
| `package.json` | Modified | create:adapter 스크립트, msw 의존성 추가 |

---

## Usage Example

### 새 어댑터 생성

```bash
# 1. 스캐폴딩 생성
npm run create:adapter -- --name rss --category feed

# 2. 생성된 파일 확인
ls src/adapters/feed/rss/
# index.ts  types.ts  __tests__/

# 3. TODO 구현 (adapter-dev subagent에게 위임)
# Task(subagent_type="adapter-dev", prompt="RSS 어댑터 구현: src/adapters/feed/rss/")

# 4. 테스트 실행
npm test -- --testPathPattern=adapters/feed/rss

# 5. AdapterFactory에 등록
# src/adapters/AdapterFactory.ts에 자동 등록됨
```

---

## Next Steps

1. **RSS 어댑터 구현**: `adapter-dev` subagent를 통해 첫 번째 Feed 어댑터 구현
2. **Markdown 어댑터 구현**: File 카테고리 첫 번째 어댑터
3. **Notion 어댑터 구현**: OAuth 카테고리 확장
4. **Frontend 연동**: JSON Schema 기반 설정 폼 자동 생성

---

## Conclusion

확장 가능한 어댑터 시스템을 통해 Insighta는 YouTube 외에도 다양한 데이터 소스를 통합할 수 있는 기반을 마련했습니다. `adapter-dev` subagent와 자동화 도구를 통해 새 어댑터 개발이 효율적으로 이루어질 수 있습니다.

---

*Implementation by: James Kim (jamesjk4242@gmail.com)*
*Date: 2025-12-22*
*Phase: 5.2 - Extensible Adapter System*
