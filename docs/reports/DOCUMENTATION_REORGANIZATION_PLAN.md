# 문서 구조 재정리 계획 (Documentation Reorganization Plan)

**작성일**: 2025-12-16
**상태**: 제안 중 (Proposal)

---

## 📋 현재 문제점 (Current Issues)

### 루트 디렉토리 혼잡 (Root Directory Clutter)
- ❌ 루트에 18개의 마크다운 파일 존재
- ❌ Phase 문서, 완료 보고서, 가이드가 모두 혼재
- ❌ 임시 세션 요약과 영구 문서가 구분되지 않음
- ❌ 명확한 네비게이션 구조 부재

### 현재 파일 목록 (Current Files)
```
Root (18 files):
├── ARCHITECTURE.md (55K) - 영구 문서
├── CLAUDE.md (4.8K) - 영구 문서
├── ESTIMATION_REPORT.md (16K) - 임시 보고서
├── IMPLEMENTATION_COMPLETE.md (11K) - 임시 보고서
├── PHASE1_IMPROVEMENTS_COMPLETE.md (10K) - Phase 문서
├── PHASE2_IMPLEMENTATION.md (10K) - Phase 문서
├── PHASE2_PLAN.md (7.0K) - Phase 문서
├── PHASE2_TEST_REPORT.md (9.9K) - Phase 문서
├── PHASE3.1_COMPLETE.md (14K) - Phase 문서
├── PHASE3.1_E2E_COMPLETE.md (14K) - Phase 문서
├── PHASE3.1_E2E_TEST_PLAN.md (17K) - Phase 문서
├── PHASE3.1_SUMMARY.md (7.6K) - Phase 문서
├── PRD.md (20K) - 영구 문서
├── README.md (12K) - 영구 문서
├── SESSION_SUMMARY.md (10K) - 임시 보고서
├── SETUP_COMPLETE.md (6.7K) - 임시 보고서
├── TASK_HIERARCHY.md (20K) - 사용자 가이드
└── TEST_GUIDE.md (9.3K) - 사용자 가이드

docs/ (1 file):
└── SETUP_OAUTH.md (7.1K) - 사용자 가이드

tests/ (2 files):
├── README.md - 테스트 문서
└── RESULTS_TEMPLATE.md - 테스트 템플릿
```

---

## 🎯 재정리 목표 (Reorganization Goals)

1. **명확한 계층 구조**: 문서를 용도별로 분류
2. **쉬운 탐색**: 새로운 사용자가 문서를 쉽게 찾을 수 있도록
3. **유지보수성**: 향후 Phase 추가 시 확장 가능한 구조
4. **루트 정리**: 루트에는 핵심 문서만 유지 (README, PRD, ARCHITECTURE, CLAUDE)

---

## 📁 제안된 새 구조 (Proposed New Structure)

```
sync-youtube-playlists/
├── README.md (메인 진입점 - 업데이트 필요)
├── PRD.md (제품 요구사항)
├── ARCHITECTURE.md (아키텍처 상세)
├── CLAUDE.md (Claude Code 작업 가이드)
│
├── docs/
│   ├── INDEX.md (📚 NEW - 전체 문서 네비게이션)
│   │
│   ├── guides/ (사용자 가이드)
│   │   ├── SETUP_OAUTH.md (OAuth 설정 가이드)
│   │   ├── TEST_GUIDE.md (테스트 실행 가이드)
│   │   └── TASK_HIERARCHY.md (작업 구조 가이드)
│   │
│   ├── phases/ (개발 Phase 문서)
│   │   ├── phase1/
│   │   │   └── PHASE1_IMPROVEMENTS_COMPLETE.md
│   │   ├── phase2/
│   │   │   ├── PHASE2_PLAN.md
│   │   │   ├── PHASE2_IMPLEMENTATION.md
│   │   │   └── PHASE2_TEST_REPORT.md
│   │   └── phase3/
│   │       ├── PHASE3.1_COMPLETE.md
│   │       ├── PHASE3.1_SUMMARY.md
│   │       ├── PHASE3.1_E2E_COMPLETE.md
│   │       └── PHASE3.1_E2E_TEST_PLAN.md
│   │
│   └── reports/ (완료 보고서 및 세션 요약)
│       ├── SETUP_COMPLETE.md
│       ├── IMPLEMENTATION_COMPLETE.md
│       ├── ESTIMATION_REPORT.md
│       └── sessions/
│           └── SESSION_SUMMARY_20251216.md (날짜별 세션)
│
└── tests/
    ├── README.md (테스트 가이드)
    └── RESULTS_TEMPLATE.md (결과 템플릿)
```

---

## 🔄 파일 이동 계획 (File Migration Plan)

### 1단계: 새 디렉토리 생성
```bash
docs/guides/
docs/phases/phase1/
docs/phases/phase2/
docs/phases/phase3/
docs/reports/
docs/reports/sessions/
```

### 2단계: Phase 문서 이동
| 현재 위치 | 새 위치 | 비고 |
|-----------|---------|------|
| `PHASE1_IMPROVEMENTS_COMPLETE.md` | `docs/phases/phase1/PHASE1_IMPROVEMENTS_COMPLETE.md` | Phase 1 완료 문서 |
| `PHASE2_PLAN.md` | `docs/phases/phase2/PHASE2_PLAN.md` | Phase 2 계획 |
| `PHASE2_IMPLEMENTATION.md` | `docs/phases/phase2/PHASE2_IMPLEMENTATION.md` | Phase 2 구현 |
| `PHASE2_TEST_REPORT.md` | `docs/phases/phase2/PHASE2_TEST_REPORT.md` | Phase 2 테스트 |
| `PHASE3.1_COMPLETE.md` | `docs/phases/phase3/PHASE3.1_COMPLETE.md` | Phase 3.1 완료 |
| `PHASE3.1_SUMMARY.md` | `docs/phases/phase3/PHASE3.1_SUMMARY.md` | Phase 3.1 요약 |
| `PHASE3.1_E2E_COMPLETE.md` | `docs/phases/phase3/PHASE3.1_E2E_COMPLETE.md` | Phase 3.1 E2E 완료 |
| `PHASE3.1_E2E_TEST_PLAN.md` | `docs/phases/phase3/PHASE3.1_E2E_TEST_PLAN.md` | Phase 3.1 E2E 테스트 계획 |

### 3단계: 사용자 가이드 이동
| 현재 위치 | 새 위치 | 비고 |
|-----------|---------|------|
| `docs/SETUP_OAUTH.md` | `docs/guides/SETUP_OAUTH.md` | OAuth 설정 가이드 |
| `TEST_GUIDE.md` | `docs/guides/TEST_GUIDE.md` | 테스트 가이드 |
| `TASK_HIERARCHY.md` | `docs/guides/TASK_HIERARCHY.md` | 작업 구조 가이드 |

### 4단계: 완료 보고서 이동
| 현재 위치 | 새 위치 | 비고 |
|-----------|---------|------|
| `SETUP_COMPLETE.md` | `docs/reports/SETUP_COMPLETE.md` | 초기 설정 완료 |
| `IMPLEMENTATION_COMPLETE.md` | `docs/reports/IMPLEMENTATION_COMPLETE.md` | 구현 완료 |
| `ESTIMATION_REPORT.md` | `docs/reports/ESTIMATION_REPORT.md` | 견적 보고서 |
| `SESSION_SUMMARY.md` | `docs/reports/sessions/SESSION_SUMMARY_20251216.md` | 세션 요약 (날짜 추가) |

### 5단계: 새 문서 생성
- **`docs/INDEX.md`**: 전체 문서 네비게이션 가이드
- **README.md 업데이트**: 새 문서 구조 반영

---

## 📚 새로운 docs/INDEX.md 개요

```markdown
# 📚 문서 인덱스 (Documentation Index)

## 🚀 시작하기
- [README](../README.md) - 프로젝트 개요 및 빠른 시작
- [SETUP_OAUTH](./guides/SETUP_OAUTH.md) - OAuth 설정 가이드

## 📖 사용자 가이드
- [OAuth 설정](./guides/SETUP_OAUTH.md)
- [테스트 실행](./guides/TEST_GUIDE.md)
- [작업 구조](./guides/TASK_HIERARCHY.md)

## 🏗️ 아키텍처 및 설계
- [ARCHITECTURE](../ARCHITECTURE.md) - 시스템 아키텍처
- [PRD](../PRD.md) - 제품 요구사항 명세

## 📊 개발 Phase 문서
### Phase 1: 핵심 동기화 기능
- [Phase 1 완료](./phases/phase1/PHASE1_IMPROVEMENTS_COMPLETE.md)

### Phase 2: 지식 관리 기능
- [Phase 2 계획](./phases/phase2/PHASE2_PLAN.md)
- [Phase 2 구현](./phases/phase2/PHASE2_IMPLEMENTATION.md)
- [Phase 2 테스트 보고서](./phases/phase2/PHASE2_TEST_REPORT.md)

### Phase 3: YouTube API 통합
- [Phase 3.1 완료](./phases/phase3/PHASE3.1_COMPLETE.md)
- [Phase 3.1 요약](./phases/phase3/PHASE3.1_SUMMARY.md)
- [Phase 3.1 E2E 테스트 완료](./phases/phase3/PHASE3.1_E2E_COMPLETE.md)
- [Phase 3.1 E2E 테스트 계획](./phases/phase3/PHASE3.1_E2E_TEST_PLAN.md)

## 📋 완료 보고서
- [초기 설정 완료](./reports/SETUP_COMPLETE.md)
- [구현 완료](./reports/IMPLEMENTATION_COMPLETE.md)
- [견적 보고서](./reports/ESTIMATION_REPORT.md)
- [세션 요약](./reports/sessions/) - 날짜별 세션 요약

## 🧪 테스트 문서
- [테스트 가이드](../tests/README.md)
- [테스트 결과 템플릿](../tests/RESULTS_TEMPLATE.md)

## 🤖 개발자 도구
- [Claude Code 가이드](../CLAUDE.md)
```

---

## ✅ 재정리 후 루트 디렉토리 (After Reorganization)

```
sync-youtube-playlists/
├── README.md (업데이트됨 ✨)
├── PRD.md
├── ARCHITECTURE.md
├── CLAUDE.md
├── docs/ (체계적으로 정리됨 ✅)
├── tests/
├── src/
├── prisma/
└── ... (기타 프로젝트 파일)
```

**루트 파일 감소**: 18개 → 4개 (78% 감소!)

---

## 🎯 README.md 업데이트 내용

**추가할 섹션**:
```markdown
## 📚 문서 구조 (Documentation Structure)

### 시작하기
- [README](./README.md) - 이 문서
- [OAuth 설정 가이드](./docs/guides/SETUP_OAUTH.md)
- [테스트 가이드](./docs/guides/TEST_GUIDE.md)

### 상세 문서
- [전체 문서 인덱스](./docs/INDEX.md) - 모든 문서 네비게이션
- [아키텍처](./ARCHITECTURE.md) - 시스템 설계
- [PRD](./PRD.md) - 제품 요구사항
- [Phase 문서](./docs/phases/) - 개발 단계별 문서
- [완료 보고서](./docs/reports/) - 완료 보고서 모음

### 개발자
- [Claude Code 가이드](./CLAUDE.md) - AI 개발 가이드
- [작업 구조](./docs/guides/TASK_HIERARCHY.md) - 작업 분류 체계
```

---

## 🚀 실행 계획 (Execution Plan)

### 옵션 1: 안전한 점진적 이동 (권장)
1. ✅ 새 디렉토리 구조 생성
2. ✅ 파일 복사 (원본 유지)
3. ✅ 새 INDEX.md 생성
4. ✅ README.md 업데이트
5. ✅ 검증 완료 후 원본 파일 삭제

### 옵션 2: 직접 이동
1. ✅ 새 디렉토리 구조 생성
2. ✅ 파일 직접 이동 (mv 명령어)
3. ✅ 새 INDEX.md 생성
4. ✅ README.md 업데이트

---

## ⚠️ 주의사항 (Warnings)

1. **Git 이력 보존**: `git mv` 사용 권장
2. **링크 업데이트**: 다른 파일에서 참조하는 링크 수정 필요
3. **백업**: 작업 전 현재 상태 커밋 권장
4. **점진적 적용**: 한 번에 모든 파일을 이동하지 않고 단계별 검증

---

## 📝 다음 단계 (Next Steps)

1. **승인 대기**: 이 계획에 대한 사용자 승인
2. **실행**: 승인 후 파일 이동 실행
3. **검증**: 모든 링크와 참조가 올바른지 확인
4. **커밋**: 변경사항 git 커밋

---

**작성자**: Claude Code (SuperClaude)
**버전**: 1.0
**상태**: 제안 중 - 사용자 승인 대기
