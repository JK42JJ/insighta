# 📖 Documentation Home

YouTube Playlist Sync 프로젝트의 문서 홈페이지입니다.

**Version**: 2.0.0
**Last Updated**: 2025-12-19
**Status**: Phase 4 Complete

---

## 📚 문서 네비게이션

### 빠른 시작
- **[📚 INDEX.md](./INDEX.md)** - 전체 문서 색인
- **[📊 현재 상태](./status/CURRENT_STATUS.md)** - 프로젝트 상태 대시보드
- **[🗺️ 로드맵](./status/ROADMAP.md)** - 다음 단계 계획

### 스펙 문서
- **[📋 PRD](./spec/PRD.md)** - 제품 요구사항 정의서
- **[🏗️ Architecture](./spec/ARCHITECTURE.md)** - 시스템 아키텍처

---

## 📁 폴더 구조

```
docs/
├── README.md                 # 📍 이 파일
├── INDEX.md                  # 문서 색인
│
├── spec/                     # 📋 스펙 문서
│   ├── PRD.md               # 제품 요구사항
│   └── ARCHITECTURE.md      # 시스템 아키텍처
│
├── status/                   # 📊 상태 문서
│   ├── CURRENT_STATUS.md    # 현재 상태
│   └── ROADMAP.md           # 로드맵
│
├── implementation-reports/   # 📝 구현 보고서
│   ├── 01-authentication.md
│   ├── 02-playlist-api.md
│   ├── 03-cli-integration.md
│   ├── 04-cli-integration-testing.md
│   ├── 05-auto-sync.md
│   ├── 06-token-refresh.md
│   ├── 07-error-handling.md
│   └── 08-test-improvements.md
│
├── phases/                   # 🗂️ Phase별 계획
│   └── phase4/
│       ├── 4-1-videos-api.md
│       ├── 4-2-4-3-analytics-sync-api.md
│       └── 4-4-4-5-rate-limit-docs.md
│
├── api/                      # API 문서
├── guides/                   # 사용 가이드
│   └── YOUTUBE_API_SETUP.md
└── reports/                  # 기타 보고서
```

---

## 🎯 주요 기능

### Core Features (Phase 1-2)
- **YouTube 플레이리스트 동기화**: URL/ID로 플레이리스트 가져오기 및 자동 동기화
- **자막 추출**: 7개 언어 지원, 다국어 자막 처리
- **AI 요약**: Gemini/OpenAI 기반 동영상 내용 요약
- **개인 메모**: 타임스탬프 기반 노트 작성
- **학습 분석**: 시청 진도 추적 및 대시보드

### API & CLI (Phase 3-4)
- **REST API**: 25+ 엔드포인트, JWT 인증
- **CLI**: 25+ 명령어, 토큰 관리
- **Rate Limiting**: API 할당량 관리
- **Documentation**: Docusaurus + OpenAPI/Scalar

---

## 🔧 설정 가이드

| 가이드 | 설명 |
|--------|------|
| [YouTube API Setup](./YOUTUBE_API_SETUP.md) | OAuth 2.0 설정 |
| [환경 변수](./../.env.example) | 환경 변수 템플릿 |

---

## 📊 프로젝트 현황

### 완료된 Phase

| Phase | 설명 | 상태 |
|-------|------|------|
| Phase 1 | Core Infrastructure | ✅ Complete |
| Phase 2 | Knowledge Management | ✅ Complete |
| Phase 3 | REST API & CLI | ✅ Complete |
| Phase 4 | Advanced API Features | ✅ Complete |

### 기술 스택
- **Language**: TypeScript (Node.js 18+)
- **Database**: SQLite / PostgreSQL (Prisma ORM)
- **API**: Fastify + JWT Authentication
- **CLI**: Commander.js
- **AI**: Gemini / OpenAI API
- **Documentation**: Docusaurus + OpenAPI

---

## 🔗 관련 링크

- **프로젝트 홈**: [../README.md](../README.md)
- **API 문서 사이트**: [docs-site/](../docs-site/)
- **소스 코드**: [src/](../src/)
- **테스트**: [tests/](../tests/)

---

## 📝 기여 가이드

### 문서 작성 규칙
1. 모든 문서는 Korean 또는 English로 작성
2. 마크다운 형식 준수
3. 코드 블록에는 언어 지정
4. 상대 경로로 링크 작성

### 문서 추가 시
1. 적절한 폴더에 파일 생성
2. `INDEX.md`에 링크 추가
3. 관련 문서에 상호 참조 추가

---

**Maintained by**: Claude Code
**Project**: YouTube Playlist Sync (TubeArchive)
