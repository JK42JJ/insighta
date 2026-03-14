# Phase 2 기능 테스트 가이드

## 🎯 테스트 목적

Phase 2로 구현된 지식 관리 기능들의 실제 동작을 검증합니다.

## 📋 사전 준비

### 1. 환경 변수 설정 확인

```bash
# .env 파일에 다음 항목이 설정되어 있는지 확인
cat .env | grep -E "(YOUTUBE_API_KEY|OPENAI_API_KEY)"
```

**필수 항목:**
- `YOUTUBE_API_KEY`: YouTube Data API v3 키
- `OPENAI_API_KEY`: OpenAI API 키 (요약 기능용)

### 2. 데이터베이스 초기화

```bash
# Prisma 마이그레이션 상태 확인
npx prisma migrate status

# 필요시 마이그레이션 실행
npx prisma migrate deploy
```

### 3. 프로젝트 빌드

```bash
npm run build
```

## 🧪 테스트 시나리오

### Scenario 1: 자막 추출 테스트

**목적**: YouTube 동영상에서 자막을 추출하고 데이터베이스에 저장

**테스트 동영상**: `dQw4w9WgXcQ` (Rick Astley - Never Gonna Give You Up)

```bash
# 1. 사용 가능한 자막 언어 확인
npm run cli caption-languages dQw4w9WgXcQ

# 예상 결과: 여러 언어 목록 출력 (en, ko, ja 등)

# 2. 영어 자막 다운로드
npm run cli caption-download dQw4w9WgXcQ -l en

# 예상 결과:
# - "Caption extracted successfully" 메시지
# - 세그먼트 수 표시
# - 데이터베이스에 저장 완료

# 3. 한국어 자막 다운로드 (있는 경우)
npm run cli caption-download dQw4w9WgXcQ -l ko

# 4. 데이터베이스 확인
npx prisma studio
# video_captions 테이블에서 저장된 자막 확인
```

**체크리스트:**
- [ ] 언어 목록이 정상적으로 표시됨
- [ ] 자막 다운로드 성공
- [ ] 세그먼트가 타임스탬프와 함께 저장됨
- [ ] 데이터베이스에 정상 저장됨
- [ ] 동일 자막 재다운로드 시 캐시 사용 (빠른 응답)

---

### Scenario 2: AI 요약 생성 테스트

**목적**: 추출된 자막을 바탕으로 AI 요약 생성

**전제조건**: Scenario 1 완료 (자막이 데이터베이스에 저장됨)

```bash
# 1. Short 레벨 요약 생성
npm run cli summarize dQw4w9WgXcQ -l short

# 예상 결과:
# - Summary (1-2 문장)
# - Key Points (3-5개)
# - Keywords (5-10개)

# 2. Medium 레벨 요약 생성
npm run cli summarize dQw4w9WgXcQ -l medium

# 예상 결과: 더 상세한 요약

# 3. Detailed 레벨 요약 생성
npm run cli summarize dQw4w9WgXcQ -l detailed --language ko

# 예상 결과: 가장 상세한 요약, 한국어로 생성

# 4. 플레이리스트 일괄 요약 (테스트용 작은 플레이리스트)
# npm run cli summarize-playlist <playlist-id> -l short
```

**체크리스트:**
- [ ] Short 요약이 간결하게 생성됨
- [ ] Medium 요약이 적절한 길이로 생성됨
- [ ] Detailed 요약이 상세하게 생성됨
- [ ] Key points와 keywords가 적절함
- [ ] 한국어 요약이 정상 생성됨 (지정 시)
- [ ] OpenAI API 호출 성공

---

### Scenario 3: 개인 노트 관리 테스트

**목적**: 타임스탬프 기반 노트 CRUD 및 검색 기능 검증

```bash
# 1. 노트 추가 (2분 30초 시점)
npm run cli note-add dQw4w9WgXcQ 150 "Important concept: Never gonna give you up" -t "lyrics,important"

# 예상 결과: 노트 생성 성공 메시지

# 2. 추가 노트 작성 (5분 20초 시점)
npm run cli note-add dQw4w9WgXcQ 320 "Key takeaway: Never gonna let you down" -t "lyrics,key"

# 3. 질문 노트 작성
npm run cli note-add dQw4w9WgXcQ 100 "Question: What's the meaning of this?" -t "question"

# 4. 전체 노트 조회
npm run cli note-list -v dQw4w9WgXcQ

# 예상 결과: 3개 노트 표시 (타임스탬프 순)

# 5. 태그로 필터링
npm run cli note-list -v dQw4w9WgXcQ -t lyrics

# 예상 결과: 2개 노트 표시

# 6. 내용 검색
npm run cli note-list -s "never gonna"

# 예상 결과: 관련 노트 표시

# 7. 시간 범위 검색 (100~200초)
npm run cli note-list -v dQw4w9WgXcQ --from 100 --to 200

# 예상 결과: 해당 범위의 노트만 표시

# 8. 노트 수정
# 먼저 note-id를 note-list에서 확인한 후
# npm run cli note-update <note-id> -c "Updated content"

# 9. Markdown으로 내보내기
npm run cli note-export ./test-notes.md -f markdown -v dQw4w9WgXcQ

# 예상 결과: test-notes.md 파일 생성

# 10. JSON으로 내보내기
npm run cli note-export ./test-notes.json -f json -v dQw4w9WgXcQ

# 11. CSV로 내보내기
npm run cli note-export ./test-notes.csv -f csv -v dQw4w9WgXcQ

# 12. 생성된 파일 확인
cat test-notes.md
cat test-notes.json
cat test-notes.csv
```

**체크리스트:**
- [ ] 노트 생성 성공
- [ ] 타임스탬프가 정상 저장됨
- [ ] 태그가 정상 저장됨
- [ ] 마크다운 내용 저장 가능
- [ ] 전체 노트 조회 성공
- [ ] 태그 필터링 작동
- [ ] 내용 검색 작동
- [ ] 시간 범위 검색 작동
- [ ] 노트 수정 성공
- [ ] Markdown 내보내기 성공 (포맷팅 확인)
- [ ] JSON 내보내기 성공 (구조 확인)
- [ ] CSV 내보내기 성공 (쉼표, 따옴표 처리 확인)

---

### Scenario 4: 학습 분석 테스트

**목적**: 시청 세션 기록 및 학습 분석 기능 검증

```bash
# 1. 시청 세션 기록 (0초~5분, 실제로는 2분~4분만 시청)
npm run cli session-record dQw4w9WgXcQ 0 300 120 240

# 예상 결과: 세션 기록 성공 메시지

# 2. 추가 세션 기록 (5분~10분, 6분~8분 시청)
npm run cli session-record dQw4w9WgXcQ 300 600 360 480

# 3. 재시청 세션 (처음부터 다시)
npm run cli session-record dQw4w9WgXcQ 0 300 0 300

# 4. 동영상 분석 조회
npm run cli analytics-video dQw4w9WgXcQ

# 예상 결과:
# - Total watch time
# - Completion percentage
# - Watch count
# - Average session duration
# - Rewatch count

# 5. 전체 학습 대시보드
npm run cli analytics-dashboard

# 예상 결과:
# - Total videos
# - Total watch time
# - Total sessions
# - Completed/In-progress/Not-started videos
# - Recent activity
# - Top videos
# - Learning streak

# 6. 복습 추천 및 보유 메트릭
npm run cli retention dQw4w9WgXcQ

# 예상 결과:
# - Difficulty (easy/medium/hard)
# - Retention score (0-100)
# - Recommended review date
# - Last reviewed date
# - Review count

# 7. 플레이리스트 분석 (플레이리스트가 있는 경우)
# npm run cli analytics-playlist <playlist-id>
```

**체크리스트:**
- [ ] 시청 세션 기록 성공
- [ ] 여러 세션 기록 가능
- [ ] 동영상 분석 정상 표시
- [ ] 완료율 계산 정확
- [ ] 재시청 횟수 정확
- [ ] 대시보드 통계 정상 표시
- [ ] 학습 연속일 계산 정확
- [ ] 복습 추천일 계산됨
- [ ] 난이도 평가 적절
- [ ] 보유 점수 계산됨

---

## 🔍 통합 테스트 워크플로우

전체 기능을 순차적으로 테스트하는 시나리오:

```bash
# Step 1: 자막 추출
npm run cli caption-download dQw4w9WgXcQ -l en

# Step 2: AI 요약 생성
npm run cli summarize dQw4w9WgXcQ -l medium

# Step 3: 학습하면서 노트 추가
npm run cli note-add dQw4w9WgXcQ 150 "Main concept from summary" -t "summary,key"
npm run cli note-add dQw4w9WgXcQ 320 "Important detail" -t "detail"

# Step 4: 시청 세션 기록
npm run cli session-record dQw4w9WgXcQ 0 600 0 400

# Step 5: 학습 진도 확인
npm run cli analytics-video dQw4w9WgXcQ
npm run cli analytics-dashboard

# Step 6: 노트 정리 및 내보내기
npm run cli note-list -v dQw4w9WgXcQ
npm run cli note-export ./my-learning-notes.md -f markdown -v dQw4w9WgXcQ

# Step 7: 복습 계획
npm run cli retention dQw4w9WgXcQ
```

## 📊 성능 테스트

### 응답 시간 측정

```bash
# 자막 추출 시간
time npm run cli caption-download dQw4w9WgXcQ -l en

# 요약 생성 시간
time npm run cli summarize dQw4w9WgXcQ -l short

# 노트 조회 시간
time npm run cli note-list -v dQw4w9WgXcQ

# 분석 조회 시간
time npm run cli analytics-dashboard
```

**성능 목표:**
- 자막 추출: < 5초 (처음), < 1초 (캐시)
- AI 요약: < 10초 (GPT-4 API 호출)
- 노트 조회: < 1초
- 분석 조회: < 2초

## 🐛 에러 시나리오 테스트

### 1. 잘못된 동영상 ID

```bash
npm run cli caption-download invalid_video_id -l en
# 예상: "Video not found" 에러 메시지
```

### 2. 지원하지 않는 언어

```bash
npm run cli caption-download dQw4w9WgXcQ -l xx
# 예상: "Language not available" 에러 메시지
```

### 3. 자막이 없는 동영상

```bash
# 자막이 없는 동영상으로 테스트
# 예상: "No captions available" 에러 메시지
```

### 4. OpenAI API 키 없음

```bash
# .env에서 OPENAI_API_KEY 제거 후
npm run cli summarize dQw4w9WgXcQ -l short
# 예상: "OpenAI API key not configured" 에러 메시지
```

### 5. 존재하지 않는 노트 삭제

```bash
npm run cli note-delete non-existent-note-id
# 예상: "Note not found" 에러 메시지
```

## 📝 테스트 결과 기록

### Phase 2.1: 자막 추출 및 요약
- [ ] 자막 추출 기능 정상 작동
- [ ] AI 요약 생성 정상 작동
- [ ] 오류 처리 적절

### Phase 2.2: 개인 노트
- [ ] CRUD 기능 정상 작동
- [ ] 검색 기능 정상 작동
- [ ] 내보내기 기능 정상 작동

### Phase 2.3: 학습 분석
- [ ] 세션 기록 정상 작동
- [ ] 분석 계산 정확
- [ ] 대시보드 표시 정상

### 전체 평가
- [ ] 모든 핵심 기능 작동
- [ ] 오류 처리 적절
- [ ] 성능 목표 달성
- [ ] 사용자 경험 만족

## 🚀 다음 단계

테스트 완료 후:
1. 발견된 버그 수정
2. 성능 개선 사항 적용
3. 문서 업데이트
4. Phase 3 계획 수립
