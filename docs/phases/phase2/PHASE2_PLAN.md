# Phase 2 Implementation Plan
# Video Summarization & Learning Features

**Date**: 2025-12-15
**Status**: Planning

---

## 🎯 Overview

Phase 1의 플레이리스트 동기화 기능을 기반으로, 학습 플랫폼의 핵심 기능인 영상 요약, 메모 작성, 학습 분석 기능을 구현합니다.

---

## 📋 Phase 2 Features

### 1. Video Summarization (우선순위: 높음)

**목표**: YouTube 자막을 추출하고 AI를 활용하여 자동 요약 생성

#### 1.1 Caption Extraction
- YouTube Transcript API 활용하여 자막 다운로드
- 다국어 자막 지원 (한국어, 영어 우선)
- 자막이 없는 경우 대체 방안 (설명란 활용)
- 타임스탬프 정보 보존

**구현 파일**:
- `src/modules/caption/extractor.ts` - 자막 추출 로직
- `src/modules/caption/types.ts` - 자막 데이터 타입

**데이터베이스 변경**:
```prisma
model VideoCaption {
  id        String   @id @default(uuid())
  videoId   String   @map("video_id")
  language  String
  text      String   // Full transcript
  segments  String   // JSON array of {text, start, duration}
  createdAt DateTime @default(now())

  video     Video    @relation(fields: [videoId], references: [id])

  @@unique([videoId, language])
  @@map("video_captions")
}
```

#### 1.2 AI-Powered Summarization
- OpenAI API 또는 로컬 LLM 활용
- 요약 수준 설정 (짧게, 보통, 상세)
- 핵심 키워드 추출
- 주요 타임스탬프 자동 마킹

**구현 파일**:
- `src/modules/summarization/generator.ts` - AI 요약 생성
- `src/modules/summarization/config.ts` - AI 모델 설정

**CLI 명령어**:
```bash
# 자막 다운로드
npm run cli caption-download <video-id> [--language ko|en]

# 요약 생성
npm run cli summarize <video-id> [--level short|medium|detailed]

# 일괄 요약 (플레이리스트 전체)
npm run cli summarize-playlist <playlist-id>
```

### 2. Timestamp-based Note-taking (우선순위: 중간)

**목표**: 특정 시간대에 개인 메모를 작성하고 관리

#### 2.1 Note Management
- 타임스탬프 기반 메모 작성
- 마크다운 지원
- 메모 검색 및 필터링
- 태그 및 카테고리 관리

**데이터베이스 변경**:
```prisma
model VideoNote {
  id        String   @id @default(uuid())
  videoId   String   @map("video_id")
  timestamp Int      // in seconds
  content   String   // Markdown text
  tags      String?  // JSON array
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  video     Video    @relation(fields: [videoId], references: [id])

  @@index([videoId, timestamp])
  @@map("video_notes")
}
```

**CLI 명령어**:
```bash
# 메모 추가
npm run cli note-add <video-id> <timestamp> "<content>"

# 메모 목록
npm run cli note-list <video-id>

# 메모 검색
npm run cli note-search "<query>"

# 메모 내보내기 (마크다운)
npm run cli note-export <video-id> [--format md|json]
```

### 3. Learning Analytics (우선순위: 낮음)

**목표**: 학습 진도와 패턴을 추적하고 분석

#### 3.1 Watch History Tracking
- 시청 시작/종료 기록
- 시청 시간 누적
- 시청 완료율 계산

**데이터베이스 변경**:
```prisma
model WatchSession {
  id          String   @id @default(uuid())
  videoId     String   @map("video_id")
  startedAt   DateTime @map("started_at")
  endedAt     DateTime @map("ended_at")
  startPos    Int      @map("start_pos") // in seconds
  endPos      Int      @map("end_pos")   // in seconds
  duration    Int      // actual watch duration

  video       Video    @relation(fields: [videoId], references: [id])

  @@index([videoId, startedAt])
  @@map("watch_sessions")
}
```

#### 3.2 Progress Visualization
- 플레이리스트별 진도율
- 일일/주간/월간 학습 시간
- 학습 패턴 분석 (선호 시간대, 길이 등)

**CLI 명령어**:
```bash
# 학습 통계
npm run cli stats [--period day|week|month]

# 플레이리스트 진도
npm run cli progress <playlist-id>

# 학습 리포트 생성
npm run cli report [--format md|json|html]
```

---

## 🔧 Technical Implementation

### Technology Stack Additions

**Caption Extraction**:
- `youtube-transcript` - YouTube 자막 추출 라이브러리
- Alternative: YouTube Data API v3 captions endpoint

**AI Summarization**:
- Option 1: OpenAI API (GPT-4/3.5-turbo)
- Option 2: Anthropic Claude API
- Option 3: 로컬 LLM (Ollama + Llama 3)

**Note-taking**:
- `marked` - 마크다운 파싱 및 렌더링
- `gray-matter` - Front matter 지원 (메타데이터)

**Analytics**:
- Chart generation library (추후 Web UI 구현 시)
- 현재는 CLI 텍스트 기반 리포트

### Environment Variables

```env
# AI Summarization
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4-turbo-preview
SUMMARIZATION_ENABLED=true

# Caption Settings
CAPTION_LANGUAGES=ko,en
CAPTION_AUTO_DOWNLOAD=false
```

---

## 📊 Implementation Timeline

### Week 1: Video Summarization Foundation
- ✅ Database schema updates (VideoCaption model)
- ✅ Caption extraction implementation
- ✅ Basic summarization with AI
- ✅ CLI commands for caption/summary

### Week 2: Note-taking System
- ✅ Database schema updates (VideoNote model)
- ✅ Note CRUD operations
- ✅ Markdown support and parsing
- ✅ CLI commands for note management

### Week 3: Learning Analytics
- ✅ Database schema updates (WatchSession model)
- ✅ Watch history tracking
- ✅ Progress calculation logic
- ✅ CLI commands for analytics

### Week 4: Integration & Polish
- ✅ Integration testing
- ✅ Performance optimization
- ✅ Documentation updates
- ✅ User guide creation

---

## 🎓 Success Criteria

### Video Summarization
- ✅ 자막 추출 성공률 > 95% (자막이 있는 경우)
- ✅ 요약 생성 시간 < 30초 (10분 영상 기준)
- ✅ 요약 품질: 핵심 내용 포함, 읽기 쉬운 형식

### Note-taking
- ✅ 타임스탬프 정확도 100%
- ✅ 마크다운 렌더링 정확도 > 99%
- ✅ 검색 응답 시간 < 1초

### Learning Analytics
- ✅ 시청 기록 정확도 100%
- ✅ 통계 계산 정확도 100%
- ✅ 리포트 생성 시간 < 5초

---

## 🚧 Known Limitations & Considerations

### Caption Extraction
- 자막이 없는 영상은 요약 불가 (설명란 활용으로 대체)
- 자동 생성 자막의 정확도가 낮을 수 있음
- 언어별 지원 범위 제한

### AI Summarization
- API 호출 비용 발생 (OpenAI/Anthropic)
- 로컬 LLM 사용 시 하드웨어 요구사항
- 요약 품질이 영상 콘텐츠 유형에 따라 다를 수 있음

### Privacy & Data
- AI API 사용 시 자막 데이터 외부 전송 (약관 확인 필요)
- 로컬 LLM 사용으로 프라이버시 보호 가능
- 메모 및 학습 기록은 로컬에만 저장

---

## 📝 Next Steps

1. **Immediate**: VideoCaption 모델 추가 및 마이그레이션
2. **This Week**: Caption extractor 구현 및 테스트
3. **Next Week**: AI summarization 통합
4. **Following**: Note-taking system 구현

---

**Phase 2 시작 준비 완료!** 🚀

첫 번째 단계로 VideoCaption 모델을 추가하고 자막 추출 기능을 구현하겠습니다.
