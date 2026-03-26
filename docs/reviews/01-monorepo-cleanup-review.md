# Monorepo Cleanup Review (1차 검토)

## Overview
모노레포 통합 후 불필요한 파일, 중복 설정, outdated 문서 검토

**검토 일자**: 2025-12-20
**검토 범위**: 전체 프로젝트 (Root + Frontend + Docs)
**상태**: 1차 검토 완료 (코드 작업 후 2차 검토 예정)

---

## 🔴 즉시 삭제 대상 (Priority: HIGH)

### 1. Frontend Supabase 잔여물
| 파일/폴더 | 크기 | 이유 |
|-----------|------|------|
| `/frontend/supabase/` | ~50KB | tube-mandala 원본 프로젝트 잔여물 |
| `/frontend/supabase/config.toml` | - | Supabase 프로젝트 설정 |
| `/frontend/supabase/migrations/*.sql` | - | 2개 마이그레이션 파일 |
| `/frontend/supabase/functions/` | - | Edge functions |

### 2. Frontend README (Lovable 템플릿)
| 파일 | 크기 | 이유 |
|------|------|------|
| `/frontend/README.md` | 73줄 | Lovable.dev 템플릿, Root README와 중복 |

### 3. Empty/Stub 파일
| 파일 | 이유 |
|------|------|
| `/prompt/frontend_integration.md` | 빈 파일 (0 bytes) |

---

## 🟡 코드 수정 필요 (Priority: MEDIUM)

### Supabase Import 잔여 코드
| 파일 | 라인 | 문제 |
|------|------|------|
| `/frontend/src/lib/fileUpload.ts` | 1 | `import { supabase }` - 삭제된 모듈 참조 |
| `/frontend/src/data/mockData.ts` | 2 | `import { supabase }` - fetchUrlMetadata() 함수 |

**수정 방안**:
- `fileUpload.ts`: 백엔드 API로 파일 업로드 대체 또는 기능 비활성화
- `mockData.ts`: Supabase 함수 호출 제거, 백엔드 API 연동

### 환경변수 정리
| 파일 | 제거 항목 |
|------|----------|
| `/frontend/.env` | `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` |

---

## 🟠 문서 정리 (Priority: MEDIUM)

### Error Handling 문서 통합 (58KB → ~15KB)
| 파일 | 조치 | 이유 |
|------|------|------|
| `/docs/ERROR_RECOVERY_GUIDE.md` | **유지** | 단일 소스 |
| `/docs/ERROR_HANDLING_ENHANCEMENT.md` | 삭제/아카이브 | RECOVERY_GUIDE로 통합 |
| `/docs/ERROR_HANDLING_QUICK_START.md` | 삭제/아카이브 | 중복 |
| `/docs/ERROR_HANDLING_SUMMARY.md` | 삭제/아카이브 | 중복 |
| `/docs/ERROR_HANDLING_CHECKLIST.md` | 삭제/아카이브 | 중복 |

### Outdated 문서
| 파일 | 조치 | 이유 |
|------|------|------|
| `/docs/ADAPTER_SYSTEM.md` | 아카이브 | Phase 5 이전 아키텍처 |
| `/docs/TOKEN_REFRESH.md` | 아카이브 | Implementation report로 대체 |
| `/docs/CIRCUIT_BREAKER_IMPLEMENTATION.ts` | 아카이브 | docs에 코드 파일 |
| `/docs/CIRCUIT_BREAKER_TESTS.ts` | 아카이브 | docs에 테스트 파일 |

### API 문서 정리
| 파일 | 조치 | 이유 |
|------|------|------|
| `/docs/api/DOCUMENTATION_PLAN.md` | 아카이브 | 계획 완료 |
| `/docs/api/DOCUSAURUS_SETUP.md` | 아카이브 | 설정 완료 |
| `/docs/api/endpoints.md` | 아카이브 | OpenAPI 문서로 대체 |

---

## 🔵 스크립트 정리 (Priority: LOW)

### 미사용 스크립트
| 파일 | 조치 | 이유 |
|------|------|------|
| `/scripts/adapter-sync.ts` | 삭제/아카이브 | package.json에 없음 |
| `/scripts/test-runner.ts` | 삭제/아카이브 | package.json에 없음 |

---

## 🟢 설정 개선 (Priority: LOW - Optional)

### ESLint 일관성
- Root: `.eslintrc.json` (strict mode)
- Frontend: `eslint.config.js` (loose mode)
- **권장**: Frontend 엄격도 상향 조정

### TypeScript 엄격도
```json
// frontend/tsconfig.json 권장 변경
"strict": false → true
"noUnusedLocals": false → true
```

---

## 실행 계획

### Phase 1: 즉시 삭제 (안전)
```bash
rm -rf frontend/supabase/
rm frontend/README.md
rm prompt/frontend_integration.md
```

### Phase 2: 코드 수정
1. `frontend/src/lib/fileUpload.ts` - Supabase 참조 제거
2. `frontend/src/data/mockData.ts` - Supabase 함수 제거
3. `frontend/.env` - Supabase 환경변수 제거

### Phase 3: 문서 아카이브
```bash
mkdir -p docs/archive/error-handling
mkdir -p docs/archive/deprecated
mkdir -p docs/archive/api-planning

# Error handling 통합
mv docs/ERROR_HANDLING_*.md docs/archive/error-handling/

# Outdated 문서
mv docs/ADAPTER_SYSTEM.md docs/archive/deprecated/
mv docs/TOKEN_REFRESH.md docs/archive/deprecated/
mv docs/CIRCUIT_BREAKER_*.ts docs/archive/deprecated/

# API 계획 문서
mv docs/api/DOCUMENTATION_PLAN.md docs/archive/api-planning/
mv docs/api/DOCUSAURUS_SETUP.md docs/archive/api-planning/
mv docs/api/endpoints.md docs/archive/api-planning/
```

### Phase 4: 스크립트 정리
```bash
rm scripts/adapter-sync.ts
rm scripts/test-runner.ts
```

---

## 예상 효과

| 항목 | Before | After | 절감 |
|------|--------|-------|------|
| Supabase 잔여물 | ~50KB | 0 | 100% |
| Error Handling 문서 | 58KB (5개) | ~15KB (1개) | 74% |
| Outdated 문서 | ~80KB | Archive | 정리 |
| 빈/미사용 파일 | 3개 | 0 | 100% |

**총 정리 항목**: 20+ 파일/폴더

---

## 2차 검토 시 확인 사항

- [ ] Phase 1-4 실행 완료 여부
- [ ] 코드 수정 후 빌드/타입체크 통과 확인
- [ ] 추가 발견된 불필요한 파일
- [ ] Frontend 컴포넌트 연동 후 새로운 dead code
- [ ] 테스트 커버리지 변화

---

*작성일: 2025-12-20*
*작성자: James Kim (admin@insighta.one)*
*검토 방법: 3개 Explore Agent 병렬 실행*
