# Product Requirements Document (PRD)
# YouTube Playlist Sync Module

## 1. Executive Summary

### 1.1 Project Overview
개인 지식관리 및 학습 플랫폼을 위한 YouTube 플레이리스트 동기화 모듈 개발.

### 1.2 Primary Objectives
- YouTube 플레이리스트 자동 동기화
- 동영상 메타데이터 수집 및 저장
- 동영상 요약 및 개인 메모 기능을 위한 데이터 인프라 제공
- 학습 콘텐츠의 체계적 관리 지원

### 1.3 Target Users
- 개인 학습자 (개발자, 연구자, 학생)
- YouTube를 통한 지식 습득 및 관리를 원하는 사용자
- 체계적인 학습 콘텐츠 아카이빙이 필요한 사용자

---

## 2. Problem Statement

### 2.1 Current Challenges
- YouTube 플레이리스트는 동영상 링크만 관리, 추가 메타데이터 부족
- 개인 메모나 요약 기능 없음
- 플레이리스트 변경사항 추적 어려움
- 학습 진도 관리 및 콘텐츠 분석 불가능

### 2.2 Solution Approach
YouTube API를 활용한 플레이리스트 동기화 모듈을 통해:
- 자동으로 플레이리스트 변경사항 감지 및 동기화
- 동영상 메타데이터 (제목, 설명, 썸네일, 길이 등) 수집
- 로컬 데이터베이스에 구조화된 데이터 저장
- 추후 요약, 메모, 학습 진도 추적 기능의 기반 제공

---

## 3. Functional Requirements

### 3.1 Core Features

#### 3.1.1 Playlist Synchronization
**FR-1.1: Playlist Import**
- YouTube 플레이리스트 URL 또는 ID로 가져오기
- 플레이리스트 메타데이터 수집 (제목, 설명, 생성일, 동영상 개수)
- 모든 동영상 항목 수집 (페이지네이션 처리)

**FR-1.2: Automatic Sync**
- 주기적 동기화 스케줄링 (설정 가능한 간격)
- 변경사항 감지 (새 동영상 추가, 삭제, 순서 변경)
- 증분 동기화 (전체가 아닌 변경사항만)

**FR-1.3: Multi-Playlist Management**
- 여러 플레이리스트 동시 관리
- 플레이리스트 그룹화/카테고리 지정
- 플레이리스트 우선순위 설정

#### 3.1.2 Video Metadata Collection
**FR-2.1: Video Information**
- 기본 정보: 제목, 설명, 채널명, 게시일
- 미디어 정보: 길이, 썸네일 URL (여러 해상도)
- 통계 정보: 조회수, 좋아요 수, 댓글 수
- 카테고리, 태그, 언어 정보

**FR-2.2: Video Status Tracking**
- 시청 상태 (미시청, 진행중, 완료)
- 마지막 시청 위치 저장
- 시청 이력 추적

**FR-2.3: Data Enrichment**
- 자동 태그 추출 및 분류
- 관련 동영상 연결
- 플레이리스트 간 동영상 중복 감지

#### 3.1.3 Data Storage & Management
**FR-3.1: Local Database**
- 구조화된 데이터 저장 (SQLite/PostgreSQL)
- 효율적인 쿼리 및 검색 지원
- 데이터 백업 및 복원 기능

**FR-3.2: Data Schema**
```
Playlists:
  - id (primary key)
  - youtube_id (unique)
  - title
  - description
  - channel_id
  - created_at
  - updated_at
  - sync_status
  - last_synced_at

Videos:
  - id (primary key)
  - youtube_id (unique)
  - title
  - description
  - channel_id
  - channel_title
  - published_at
  - duration
  - thumbnail_urls (JSON)
  - view_count
  - like_count
  - comment_count
  - tags (JSON)
  - category_id
  - language
  - created_at
  - updated_at

PlaylistItems:
  - id (primary key)
  - playlist_id (foreign key)
  - video_id (foreign key)
  - position
  - added_at
  - removed_at (nullable)
  - created_at
  - updated_at

UserVideoStates:
  - id (primary key)
  - video_id (foreign key)
  - watch_status (enum: unwatched, watching, completed)
  - last_position (seconds)
  - watch_count
  - notes (text)
  - summary (text)
  - tags (JSON)
  - rating (1-5)
  - created_at
  - updated_at
```

#### 3.1.4 API Integration
**FR-4.1: YouTube Data API v3**
- OAuth 2.0 인증 구현
- API 쿼터 관리 (10,000 units/day 기본)
- Rate limiting 처리
- 에러 처리 및 재시도 로직

**FR-4.2: API Endpoints to Implement**
- `GET /playlists` - 플레이리스트 정보 조회
- `GET /playlistItems` - 플레이리스트 아이템 조회
- `GET /videos` - 동영상 상세 정보 조회
- `GET /channels` - 채널 정보 조회

### 3.2 Future Enhancement Features (Phase 2)

#### 3.2.1 Video Summarization
- YouTube 자막 다운로드 (여러 언어 지원)
- AI 기반 동영상 요약 생성
- 핵심 타임스탬프 추출
- 주제별 섹션 분할

#### 3.2.2 Personal Note-Taking
- 타임스탬프 기반 메모
- 마크다운 지원
- 태그 및 카테고리 관리
- 메모 검색 및 필터링

#### 3.2.3 Learning Analytics
- 시청 시간 추적 및 분석
- 학습 진도 시각화
- 학습 패턴 분석
- 추천 동영상 제안

---

## 4. Non-Functional Requirements

### 4.1 Performance
- **NFR-1.1**: 100개 동영상 플레이리스트 동기화 < 30초
- **NFR-1.2**: API 응답 시간 < 2초 (95th percentile)
- **NFR-1.3**: 동시 5개 플레이리스트 동기화 지원

### 4.2 Reliability
- **NFR-2.1**: 99% 동기화 성공률
- **NFR-2.2**: 네트워크 오류 시 자동 재시도 (exponential backoff)
- **NFR-2.3**: 데이터 손실 방지 (트랜잭션 처리)

### 4.3 Scalability
- **NFR-3.1**: 최대 100개 플레이리스트 관리
- **NFR-3.2**: 총 10,000개 동영상 지원
- **NFR-3.3**: 데이터베이스 크기 < 500MB (평균)

### 4.4 Security
- **NFR-4.1**: OAuth 2.0 토큰 안전한 저장 (암호화)
- **NFR-4.2**: API 키 환경변수 관리
- **NFR-4.3**: 개인정보 로컬 저장 (외부 전송 없음)

### 4.5 Usability
- **NFR-5.1**: CLI 인터페이스 제공
- **NFR-5.2**: 설정 파일을 통한 간편한 구성
- **NFR-5.3**: 상세한 로깅 및 에러 메시지

### 4.6 Maintainability
- **NFR-6.1**: TypeScript로 타입 안전성 확보
- **NFR-6.2**: 80% 이상 테스트 커버리지
- **NFR-6.3**: 모듈화된 아키텍처

---

## 5. Technical Architecture

### 5.1 Technology Stack

#### 5.1.1 Core Technologies
- **Language**: TypeScript (Node.js 18+)
- **Database**: SQLite (development), PostgreSQL (production option)
- **ORM**: Prisma or TypeORM
- **API Client**: Official Google APIs Client Library

#### 5.1.2 Supporting Libraries
- **Authentication**: googleapis OAuth2 client
- **CLI**: Commander.js or Yargs
- **Scheduling**: node-cron or Bull (job queue)
- **Logging**: Winston or Pino
- **Config**: dotenv, cosmiconfig
- **Testing**: Jest, Supertest
- **Validation**: Zod or Joi

### 5.2 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Interface                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Playlist   │  │    Video     │  │    Sync      │      │
│  │   Manager    │  │   Manager    │  │  Scheduler   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                  │              │
│         └─────────────────┴──────────────────┘              │
│                          │                                  │
│                 ┌────────▼─────────┐                        │
│                 │   YouTube API    │                        │
│                 │     Client       │                        │
│                 └────────┬─────────┘                        │
│                          │                                  │
│         ┌────────────────┴────────────────┐                │
│         │                                  │                │
│  ┌──────▼───────┐              ┌──────────▼──────┐         │
│  │   Database   │              │   File Storage  │         │
│  │   (SQLite/   │              │   (Thumbnails,  │         │
│  │  PostgreSQL) │              │    Cache)       │         │
│  └──────────────┘              └─────────────────┘         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Core Modules

#### 5.3.1 YouTube API Client Module
- OAuth 2.0 인증 관리
- API 호출 래퍼 (rate limiting, error handling)
- 쿼터 사용량 추적
- 응답 캐싱

#### 5.3.2 Playlist Manager Module
- 플레이리스트 CRUD 작업
- 플레이리스트 동기화 로직
- 변경사항 감지 알고리즘
- 플레이리스트 메타데이터 관리

#### 5.3.3 Video Manager Module
- 동영상 메타데이터 수집 및 저장
- 동영상 검색 및 필터링
- 중복 감지 및 관리
- 썸네일 다운로드 및 캐싱

#### 5.3.4 Sync Scheduler Module
- 주기적 동기화 스케줄링
- 동기화 작업 큐 관리
- 동기화 상태 모니터링
- 실패 처리 및 재시도

#### 5.3.5 Database Module
- 데이터 모델 정의
- 쿼리 인터페이스
- 마이그레이션 관리
- 데이터 백업/복원

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Milestone: Basic Infrastructure**
- [ ] Project setup (TypeScript, Prisma, dependencies)
- [ ] Database schema design and migration
- [ ] YouTube API authentication implementation
- [ ] Basic API client wrapper

### Phase 2: Core Sync (Week 3-4)
**Milestone: Manual Sync Working**
- [ ] Playlist import functionality
- [ ] Video metadata collection
- [ ] Basic sync logic (add/remove detection)
- [ ] CLI commands for manual sync

### Phase 3: Automation (Week 5-6)
**Milestone: Automated Sync**
- [ ] Sync scheduler implementation
- [ ] Incremental sync optimization
- [ ] Error handling and retry logic
- [ ] Logging and monitoring

### Phase 4: Enhancement (Week 7-8)
**Milestone: Production Ready**
- [ ] Multi-playlist management
- [ ] Advanced search and filtering
- [ ] Performance optimization
- [ ] Comprehensive testing
- [ ] Documentation

### Phase 5: Extended Features (Future)
**Milestone: Learning Platform Features**
- [ ] Video summarization integration
- [ ] Personal note-taking system
- [ ] Learning analytics
- [ ] Web UI (optional)

---

## 7. API Quota Management

### 7.1 YouTube API Quota Costs
- Playlist details: 1 unit
- PlaylistItems list (50 items): 1 unit
- Videos list (50 videos): 1 unit
- Total for 100-video playlist: ~5 units

### 7.2 Optimization Strategies
- 캐싱 활용 (변경되지 않은 데이터 재사용)
- 배치 처리 (50개씩 묶어서 요청)
- 증분 동기화 (전체가 아닌 변경사항만)
- 스마트 스케줄링 (변경 빈도에 따라 조정)

### 7.3 Quota Monitoring
- 일일 쿼터 사용량 추적
- 쿼터 초과 시 알림
- 우선순위 기반 동기화

---

## 8. Success Metrics

### 8.1 Technical Metrics
- API 호출 성공률 > 99%
- 평균 동기화 시간 < 30초 (100개 동영상)
- 데이터 정확도 100% (YouTube와 일치)
- 테스트 커버리지 > 80%

### 8.2 User Experience Metrics
- 설정 완료 시간 < 5분
- CLI 명령 응답 시간 < 2초
- 에러 발생 시 명확한 메시지 제공

### 8.3 Business Metrics
- 개인 학습 플랫폼 데이터 소스로 안정적 작동
- 향후 요약/메모 기능 구현 가능한 데이터 구조
- 확장 가능한 아키텍처

---

## 9. Risk Assessment

### 9.1 Technical Risks
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| API 쿼터 초과 | High | Medium | 캐싱, 증분 동기화, 스마트 스케줄링 |
| API 응답 변경 | Medium | Low | 버전 고정, 에러 처리, 모니터링 |
| 대용량 플레이리스트 성능 | Medium | Medium | 페이지네이션, 배치 처리, 비동기 |
| 데이터 일관성 문제 | High | Low | 트랜잭션, 검증 로직, 백업 |

### 9.2 Business Risks
| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| YouTube API 정책 변경 | High | Low | 공식 문서 모니터링, 유연한 설계 |
| 사용자 요구사항 변경 | Medium | Medium | 모듈화 아키텍처, 확장성 고려 |

---

## 10. Compliance & Legal

### 10.1 YouTube API Terms of Service
- API 사용 약관 준수
- 사용자 데이터 로컬 저장만 허용
- 쿼터 제한 준수
- 적절한 attribution 표시

### 10.2 Data Privacy
- 개인 OAuth 토큰 안전한 저장
- 로컬 데이터베이스 (외부 전송 없음)
- 사용자 동의 하에 데이터 수집

---

## 11. Documentation Requirements

### 11.1 Technical Documentation
- API 참조 문서
- 아키텍처 설계 문서
- 데이터베이스 스키마 문서
- 배포 가이드

### 11.2 User Documentation
- 설치 가이드
- 설정 가이드
- CLI 명령어 참조
- 문제 해결 가이드

### 11.3 Developer Documentation
- 개발 환경 설정
- 코드 스타일 가이드
- 기여 가이드
- 테스트 가이드

---

## 12. Appendix

### 12.1 References
- [YouTube Data API v3 Documentation](https://developers.google.com/youtube/v3)
- [OAuth 2.0 for Google APIs](https://developers.google.com/identity/protocols/oauth2)
- [Prisma Documentation](https://www.prisma.io/docs)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs/)

### 12.2 Glossary
- **Playlist**: YouTube에서 동영상들의 모음
- **Playlist Item**: 플레이리스트 내의 개별 동영상 항목
- **Sync**: 플레이리스트의 변경사항을 로컬 데이터베이스에 반영하는 프로세스
- **Quota**: YouTube API 일일 사용 한도
- **Incremental Sync**: 전체가 아닌 변경된 부분만 동기화

### 12.3 Version History
- v1.0 (2024-12-14): Initial PRD creation
