# Adapter Development Patterns

TubeArchive 어댑터 개발을 위한 패턴 및 가이드라인.

## Quick Reference

### Base 클래스 선택

| 카테고리 | Base 클래스 | 사용 예시 |
|---------|------------|----------|
| OAuth 2.0 | `BaseOAuthAdapter` | YouTube, Notion, Google Drive, LinkedIn |
| Feed | `BaseFeedAdapter` | RSS, Atom |
| File | `BaseFileAdapter` | Markdown, PDF, DOCX, PPTX, TXT |

### 필수 구현 메서드

**공통 (모든 어댑터)**:
- `getAdapterInfo()` - 어댑터 메타데이터 및 JSON Schema
- `fetchCollection()` - 컬렉션 조회
- `fetchCollectionItems()` - 컬렉션 아이템 목록
- `fetchContentItem()` - 개별 콘텐츠 조회
- `getSchema()` - 콘텐츠 스키마
- `getCapabilities()` - 어댑터 기능

**OAuth 어댑터 전용**:
- `getOAuthConfig()` - OAuth 설정
- `exchangeCodeForTokens()` - 코드 → 토큰 교환
- `refreshAccessToken()` - 토큰 갱신

**Feed 어댑터 전용**:
- `parseFeed()` - 피드 파싱
- `mapFeedItemToContentItem()` - 아이템 매핑

**File 어댑터 전용**:
- `getSupportedExtensions()` - 지원 확장자
- `parseFile()` - 파일 파싱
- `extractTitle()` - 제목 추출

---

## Adapter 생성 Workflow

### Step 1: Scaffolding

```bash
# OAuth 어댑터 생성
npm run create:adapter -- --name notion --category oauth

# Feed 어댑터 생성
npm run create:adapter -- --name rss --category feed

# File 어댑터 생성
npm run create:adapter -- --name markdown --category file
```

### Step 2: 구현

1. `index.ts` - TODO 섹션 구현
2. `types.ts` - 소스별 타입 정의
3. `parser.ts` (file only) - 파싱 로직

### Step 3: 테스트

```bash
npm test -- --testPathPattern=adapters/{category}/{name}
```

### Step 4: 등록

```typescript
// src/adapters/AdapterFactory.ts
import { MyAdapter } from './{category}/{name}';

if (!adapterConstructors.has('my_source')) {
  adapterConstructors.set('my_source', MyAdapter);
}
```

---

## JSON Schema Pattern

Frontend 폼 자동 생성을 위한 JSON Schema:

```typescript
getAdapterInfo(): AdapterInfo {
  return {
    // ...
    configSchema: {
      type: 'object',
      properties: {
        // 필수 필드
        feedUrl: {
          type: 'string',
          format: 'uri',
          title: 'Feed URL',
          description: 'RSS/Atom feed URL to sync',
        },
        // 선택 필드 with 기본값
        refreshInterval: {
          type: 'number',
          title: 'Refresh Interval',
          description: 'Refresh interval in seconds',
          default: 3600,
          minimum: 60,
          maximum: 86400,
        },
        // Boolean 필드
        includeContent: {
          type: 'boolean',
          title: 'Include Full Content',
          description: 'Fetch full article content',
          default: true,
        },
        // Enum 필드
        contentFormat: {
          type: 'string',
          enum: ['html', 'markdown', 'text'],
          title: 'Content Format',
          default: 'html',
        },
      },
      required: ['feedUrl'],
    },
  };
}
```

### Schema Types

| Type | Frontend Component |
|------|-------------------|
| `string` | Text Input |
| `string` + `format: 'uri'` | URL Input with validation |
| `number` | Number Input |
| `boolean` | Toggle/Checkbox |
| `string` + `enum` | Select/Dropdown |
| `array` | Multi-select or List |

---

## Error Handling Pattern

### AdapterError 사용

```typescript
import { AdapterError, AdapterErrorCode } from '../DataSourceAdapter';

// 인증 실패
throw new AdapterError(
  AdapterErrorCode.AUTH_FAILED,
  'OAuth authentication failed',
  this.sourceType,
  originalError,
  { statusCode: 401 }
);

// 리소스 없음
throw new AdapterError(
  AdapterErrorCode.NOT_FOUND,
  `Item not found: ${itemId}`,
  this.sourceType
);

// Rate Limit
throw new AdapterError(
  AdapterErrorCode.RATE_LIMITED,
  'API rate limit exceeded',
  this.sourceType,
  undefined,
  { retryAfter: 60 }
);

// 네트워크 오류
throw new AdapterError(
  AdapterErrorCode.NETWORK_ERROR,
  `Failed to fetch: ${url}`,
  this.sourceType,
  originalError,
  { url, status: response.status }
);
```

### Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `AUTH_FAILED` | 인증 실패 | 401 |
| `AUTH_EXPIRED` | 토큰 만료 | 401 |
| `NOT_FOUND` | 리소스 없음 | 404 |
| `RATE_LIMITED` | Rate limit 초과 | 429 |
| `QUOTA_EXCEEDED` | 할당량 초과 | 429 |
| `NETWORK_ERROR` | 네트워크 오류 | 5xx |
| `INVALID_INPUT` | 잘못된 입력 | 400 |
| `INTERNAL_ERROR` | 내부 오류 | 500 |

---

## Caching Pattern

### BaseAdapter 캐시 사용

```typescript
// 캐시에서 가져오기
const cached = this.getCached<MyData>('cache-key');
if (cached) return cached;

// 캐시에 저장 (기본 5분)
this.setCache('cache-key', data);

// TTL 지정 (밀리초)
this.setCache('cache-key', data, 60000); // 1분
```

### 캐시 전략

| 데이터 유형 | TTL | 이유 |
|------------|-----|------|
| 컬렉션 메타데이터 | 5분 | 빈번한 조회, 느린 변경 |
| 아이템 목록 | 2분 | 추가/삭제 감지 필요 |
| 콘텐츠 상세 | 10분 | 거의 변경 없음 |
| 인증 토큰 | 만료 시간 - 60초 | 갱신 버퍼 필요 |

---

## Quota Management Pattern

### Quota 추적

```typescript
// API 호출 시 quota 사용량 추가
this.addQuotaCost(1);

// Quota 확인
if (!this.checkQuota(requiredCost)) {
  throw new AdapterError(
    AdapterErrorCode.QUOTA_EXCEEDED,
    'Daily quota exceeded',
    this.sourceType
  );
}
```

### YouTube API Quota 참고

| Operation | Cost | Notes |
|-----------|------|-------|
| Playlist list | 1 | 50개 단위 |
| PlaylistItems list | 1 | 50개 단위 |
| Videos list | 1 | 50개 단위 |
| Search | 100 | 비용 높음 - 최소화 |

**전략**:
- 배치 처리 (50개 단위)
- 캐시 활용
- 증분 동기화

---

## Testing Pattern

### MSW 기반 통합 테스트

```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.get('https://api.example.com/items', () => {
    return HttpResponse.json({
      items: [{ id: '1', title: 'Test' }],
    });
  }),

  http.get('https://api.example.com/items/:id', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      title: 'Test Item',
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 에러 시나리오 테스트

```typescript
it('should handle 401 error', async () => {
  server.use(
    http.get('https://api.example.com/items', () => {
      return new HttpResponse(null, { status: 401 });
    }),
  );

  await expect(adapter.fetchCollection('test')).rejects.toThrow(
    AdapterError
  );
});

it('should handle rate limiting', async () => {
  server.use(
    http.get('https://api.example.com/items', () => {
      return new HttpResponse(null, {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }),
  );

  await expect(adapter.fetchCollection('test')).rejects.toMatchObject({
    code: AdapterErrorCode.RATE_LIMITED,
  });
});
```

---

## Recommended Libraries

| 카테고리 | 라이브러리 | 용도 |
|---------|-----------|------|
| RSS/Atom | `rss-parser` | 피드 파싱 |
| Markdown | `gray-matter` | Frontmatter 파싱 |
| Markdown | `marked` | Markdown → HTML |
| PDF | `pdf-parse` | PDF 텍스트 추출 |
| DOCX | `mammoth` | DOCX → HTML/텍스트 |
| Testing | `msw` | API 모킹 |

---

## Reference Files

| 파일 | 설명 |
|-----|------|
| `src/adapters/DataSourceAdapter.ts` | Core interface |
| `src/adapters/core/base-adapter.ts` | BaseAdapter 추상 클래스 |
| `src/adapters/oauth/base-oauth-adapter.ts` | OAuth 베이스 클래스 |
| `src/adapters/feed/base-feed-adapter.ts` | Feed 베이스 클래스 |
| `src/adapters/file/base-file-adapter.ts` | File 베이스 클래스 |
| `src/adapters/YouTubeAdapter.ts` | Reference implementation |
| `src/adapters/AdapterFactory.ts` | Factory pattern |
| `src/adapters/AdapterRegistry.ts` | Registry pattern |
| `.claude/agents/adapter-dev.md` | adapter-dev subagent |

---

## Checklist

새 어댑터 구현 시 확인사항:

- [ ] Base 클래스 올바르게 상속
- [ ] `getAdapterInfo()` with JSON Schema 구현
- [ ] 필수 메서드 모두 구현
- [ ] 에러 처리 (`AdapterError` 사용)
- [ ] 캐싱 전략 적용
- [ ] Quota 관리 (해당 시)
- [ ] 테스트 작성 (MSW 기반)
- [ ] AdapterFactory에 등록
- [ ] 환경 변수 문서화
