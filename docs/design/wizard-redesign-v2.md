# 위저드 + 카드 추천 통합 재설계 — 실행 계획 v2

> **승인**: 2026-04-14
> **원본 핸드오프**: insighta-wizard-redesign-handoff-final (1).md
> **CC 리뷰**: CP376 세션에서 코드베이스 대조 검증 완료

---

## 현재 문제 (전부 연결됨)

| # | 문제 | 심각도 | 원인 |
|---|------|--------|------|
| 1 | 카드 추천 0건 또는 12건 | CRITICAL | video-discover executor가 LLM 검색어를 제대로 활용 못함 |
| 2 | 추천 품질 퇴보 — 2~6년 전 영상, 언어 혼재 | CRITICAL | publishedAfter 미사용, 언어 감지가 로케일 기반 |
| 3 | 목표 왜곡 | HIGH | LLM이 center_goal 재작성 (수정됨, 미커밋) |
| 4 | actions 64개 미생성 | HIGH | fire-and-forget 실패 시 무알림 |
| 5 | Pipeline 실패 시 90초 무알림 | HIGH | 카드 0장이어도 사용자에게 피드백 없음 |
| 6 | YouTube quota 소진 무알림 | HIGH | 만다라당 ~800 units, 일 12개 한계 |
| 7 | Zustand 미리셋 | MEDIUM | 계정 전환 시 이전 유저 mandalaId 잔존 (수정됨, 미커밋) |
| 8 | BE WHERE user_id 누락 | MEDIUM | update/delete에 id만 사용 (수정됨, 미커밋) |

---

## 절대 규칙

1. 추측 기반 수정 금지 — 원인을 코드에서 확인한 후에만 수정
2. center_goal은 사용자 입력 그대로. LLM 재작성 금지. 코드에서 강제.
3. sub_labels: 짧은 게 의미 전달되면 짧게. 무의미 축약 금지. 카멜케이스 금지.
4. 언어 감지 = 만다라 텍스트 기반 (로케일 아님)
5. LoRA 코드 삭제 금지
6. CardListView 스켈레톤 제거/대체 금지
7. OpenRouter 모델 ID: anthropic/claude-haiku-4.5
8. 한 번에 한 기능 변경 → 테스트 → 다음 기능
9. KO/EN 프롬프트 분기: EN 기준, KO는 동일 의미로 번역 + 기존 KO 프롬프트 스타일 유지

---

## Phase 0: 미커밋 보안 수정 + DB 스키마 + 인프라 준비

### 0-1. 보안 수정 7파일 커밋
- mandalaStore.ts — Zustand 로그아웃 리셋 (auth event bus)
- manager.ts — WHERE user_id 추가 (update/delete 5곳)
- useWizard.ts — optimistic stub userId + useAuth import
- generator.ts — center_goal 코드 강제 (3경로)
- mandalas.ts — create-from-template user_id guard
- MandalaSettingsTab.tsx — 연속 삭제 guard (deletingId)
- mandala-manager.test.ts — WHERE user_id assertion 4곳

### 0-2. sub_labels 상수 완화
- generator.ts: KO_SUB_LABEL_MAX 6→10, EN_SUB_LABEL_MAX 8→15
- generator.ts 프롬프트 내 "최대 6글자" → "최대 10자", "max 8 chars" → "max 15 chars"

### 0-3. DB 스키마 추가
```prisma
// schema.prisma user_mandalas 모델에 추가
focus_tags   String[]  @default([])
target_level String    @default("standard") @db.VarChar(20)
```
- prisma db push (local) → 검증 → ALTER TABLE (prod)

### 0-4. API 파라미터 추가
- mandalas.ts create-with-data: request.body에 focusTags?, targetLevel? 추가
- mandalas.ts create-from-template: 동일
- manager.createMandala: data에 focus_tags, target_level 전달

### 0-5. 만다라 일일 5개 제한
```typescript
// mandalas.ts create-with-data, create-from-template 두 endpoint
const DAILY_MANDALA_LIMIT = 5;
const todayCount = await prisma.user_mandalas.count({
  where: { user_id: userId, created_at: { gte: startOfDayUTC() } }
});
if (todayCount >= DAILY_MANDALA_LIMIT) {
  return reply.code(429).send({
    status: 429, code: 'DAILY_LIMIT_REACHED',
    message: `Daily mandala creation limit reached (${todayCount}/${DAILY_MANDALA_LIMIT})`
  });
}
```

### 0-6. src/prompts/ 디렉토리 생성

### 0-7. push + deploy
→ 검증: 계정 전환 + 목표 보존 + sub_labels 길이 + 6개/일 차단

---

## Phase 1: 카드 추천 품질 (BE, executor.ts 중심)

### 1-1. src/prompts/search-query-generator.ts (프롬프트 #3)
- KO/EN 분기 포함
- focus_tags, target_level 파라미터

### 1-2. llm-query-generator.ts 교체
- generateSearchQueriesRace → generateSearchQueries (Haiku 단일)
- 기존 Ollama(llama3.1) + OpenRouter race 제거
- executor.ts:788 호출부 수정 (focusTags, targetLevel 전달)

### 1-3. executor.ts: publishedAfter 1년 추가
```typescript
publishedAfter: new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()
```

### 1-4. executor.ts: title 기반 언어 post-filter
```typescript
if (language === 'ko' && !/[가-힣]/.test(video.title)) skip;
if (language === 'en' && /[가-힣]/.test(video.title)) skip;
```

### 1-5. executor.ts: 광고 키워드 filter
```typescript
const AD_KEYWORDS = ['PPL', '광고', '협찬', '제공', 'sponsored', 'ad', '#ad'];
```

### 1-6. executor.ts: keyword_scores preflight fatal → warning
- 0행이어도 LLM 검색어(프롬프트 #3)로 진행
- IKS 가중치 = 0으로 처리

### 1-7. search.ts: threshold 0.4 → 0.3

### 1-8. pipeline-runner.ts:127 embeddings 30초 timeout
```typescript
const result = await Promise.race([
  ensureMandalaEmbeddings(mandalaId),
  new Promise(resolve => setTimeout(() => resolve({ ok: false, reason: 'embedding timeout 30s' }), 30_000))
]);
```

→ 검증:
- PASS: 8셀 중 6셀+ 카드 AND 18개+ AND 언어 일치 AND 최근 2년
- FAIL: 12개 미만 또는 언어 혼재

---

## Phase 2: 프롬프트 분리 + 만다라 생성 2단계 분리

### 2-1. src/prompts/structure-generator.ts (프롬프트 #1, KO/EN)
### 2-2. src/prompts/actions-generator.ts (프롬프트 #2, KO/EN)
### 2-3. generator.ts: prompts/ import로 교체
### 2-4. 구조(~3초) + actions 백그라운드(~15초) Promise.allSettled 분리
### 2-5. sub_labels 프롬프트 길이 규칙 통일 (KO 4-10자, EN 4-15자)
### 2-6. LoRA 백그라운드 유지

→ 검증: 3초 이내 구조 프리뷰 + 대시보드에서 actions 비동기 채움

---

## Phase 3: 위저드 UX 2스텝 (FE only — DB/API는 Phase 0 완료)

### 3-1. WizardStepContext.tsx 신규
- "더 집중하고 싶은 것이 있나요?" + 태그 입력
- [Foundation] [●Standard] [Advanced]

### 3-2. useWizard.ts: 2스텝 흐름
- state에 focusTags: string[], targetLevel: string 추가
- complete()에서 API에 전달

### 3-3. MandalaWizardPage: Preview 스텝 제거, Skills 스텝 제거

→ 검증: 2스텝 흐름 정상 + tags/level이 프롬프트에 반영

---

## Phase 4: 에러 핸들링 + 프로그레스

### 4-1. POST /mandalas/:id/trigger-pipeline 신규 endpoint
- 인증 + ownership(user_id) + dedup gate(5분)

### 4-2. GET /mandalas/:id/pipeline-status 신규 endpoint
- mandala_pipeline_runs 최신 row 반환

### 4-3. CardDiscoveryProgress: pipeline status 연동 + 실패 시 Retry

### 4-4. fade 애니메이션 (key={step} + CSS)
```css
@keyframes insighta-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes breathe {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
```

### 4-5. YouTube quota 소진 시 "일일 한도 도달" 메시지

→ 검증: 네트워크 차단 → 에러 UI + Retry 동작

---

## 파일 목록 (예상)

| Phase | 파일 | 변경 |
|-------|------|------|
| 0 | mandalaStore.ts, manager.ts, useWizard.ts, generator.ts, mandalas.ts, MandalaSettingsTab.tsx, mandala-manager.test.ts | 보안 수정 커밋 |
| 0 | schema.prisma | focus_tags(text[]), target_level(varchar) 추가 |
| 0 | mandalas.ts (API routes) | focusTags, targetLevel 파라미터 + 일일 5개 제한 |
| 0 | generator.ts | sub_labels 상수 KO 10, EN 15 |
| 0 | src/prompts/ (신규 디렉토리) | 생성만 |
| 1 | src/prompts/search-query-generator.ts (신규) | 프롬프트 #3 |
| 1 | llm-query-generator.ts | race → Haiku 단일 호출 교체 |
| 1 | executor.ts | publishedAfter, 언어 필터, 광고 필터, keyword_scores warning |
| 1 | search.ts | threshold 0.4→0.3 |
| 1 | pipeline-runner.ts | embeddings 30초 timeout |
| 2 | src/prompts/structure-generator.ts (신규) | 프롬프트 #1 |
| 2 | src/prompts/actions-generator.ts (신규) | 프롬프트 #2 |
| 2 | generator.ts | prompts/ import, 2단계 분리, sub_labels 규칙 통일 |
| 3 | WizardStepContext.tsx (신규) | 태그 + 목표 수준 UI |
| 3 | useWizard.ts | 2스텝 흐름, tags/level 전달 |
| 3 | MandalaWizardPage.tsx | Preview/Skills 스텝 제거 |
| 4 | mandalas.ts (API routes) | trigger-pipeline, pipeline-status 신규 |
| 4 | CardDiscoveryProgress.tsx | fade 애니메이션 + 실패 UI + Retry |
| 4 | IndexPage.tsx | pipeline status 연동 + 스켈레톤 공존 |
| 4 | index.css | @keyframes insighta-fade-in, breathe |
