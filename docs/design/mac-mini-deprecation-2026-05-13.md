# Mac Mini Deprecation Roadmap — 2026-05-13

**Status**: Draft (not yet committed)
**Origin**: 사용자 directive 2026-05-12 "Mac Mini 는 임시 패턴, 향후 BE 로 통합되어야"
**Companion**: `docs/design/insighta-hybrid-retrieval-2026-05-12.md` (PR #611) — 그 spec 에서 reranker 를 Mac Mini 가 아닌 Cohere 로 결정한 것의 연장선

---

## 1. 왜 Mac Mini 를 deprecate 해야 하는가

| 문제 | 영향 |
|------|------|
| 단일 머신 / 가정용 네트워크 / 소유자 물리적 존재 의존 | SLA 보증 불가 |
| Seoul ↔ us-west-2 Tailscale RTT ~100-200ms baseline + tail risk | latency / cost-of-time |
| auto-restart / metrics / horizontal scale 없음 | 매 outage = 수동 복구 |
| LoRA / fine-tuned 모델은 GitHub Actions / CI 에서 재현 불가 | 배포 자동화 어려움 |
| 새 inference 의존 추가 시 마이그레이션 cost 누적 | architectural debt |

→ Mac Mini 는 production-critical inference 의 **임시 scaffold**. 영구 위치 아님.

---

## 2. 현 상태 인벤토리 — 무엇이 Mac Mini 에 있는가

### A. 마이그레이션 완료 (Mac Mini path = dead code / fallback)

| 서비스 | 마이그레이션 대상 | 적용 commit/PR |
|--------|------------------|----------------|
| `chat-qwen-lora` (챗봇) | RunPod Serverless | CP449, commit `2793853` (`feat(chatbot): chat-qwen.ts RunPod Serverless branch`) |
| `qwen3-embedding:8b` (mandala embed) | OpenRouter `qwen/qwen3-embedding-8b` | Phase 1, 2026-04-22. env `MANDALA_EMBED_PROVIDER=openrouter` (prod 활성) |

### B. 미마이그레이션 (현재 prod 가 Mac Mini 에 의존)

| 호출자 | 사용 모델 / 용도 | 파일 / 위치 |
|--------|-----------------|-------------|
| **action fill (post-creation)** | `mandala-gen:latest` (LoRA) — center_goal → 8 sub_goals × 8 actions | `src/modules/mandala/generator.ts:426`, env `MANDALA_GEN_URL`, default `http://100.91.173.17:11434` |
| **mandala search (Haiku fallback)** | Mac Mini Ollama 동일 모델 | `src/modules/mandala/search.ts:83-107`, 동일 env |
| **iks-scorer embed fallback** | `qwen3-embedding:8b` | `src/skills/plugins/iks-scorer/embedding.ts:32`, hardcoded `MAC_MINI_OLLAMA_DEFAULT_URL` (env `IKS_EMBED_PROVIDER=ollama` 시 활성) |
| **video-discover LLM query (Tier 2)** | Ollama 일반 LLM (qwen-7b 추정) | `src/skills/plugins/video-discover/sources/llm-query-generator.ts:39`, hardcoded `DEFAULT_OLLAMA_URL` |
| **trend-collector LLM extract** | Ollama | `src/skills/plugins/trend-collector/sources/llm-extract.ts:24`, 동일 |
| `prewarmMandalaModel` (cron) | LoRA 모델 keep-alive | `src/modules/mandala/generator.ts:1171` |

→ **6 호출 site, 3 종류 모델** (LoRA action-fill, embedding fallback, 일반 LLM).

### C. 이미 OpenRouter 로 가는 fallback 경로

- `IKS_EMBED_PROVIDER=ollama` 일 때도 Mac Mini 실패 시 자동 OpenRouter fallback (`embedBatch` 의 transport/HTTP failure 핸들링)
- `MANDALA_EMBED_PROVIDER=openrouter` 일 때 Mac Mini 우회

→ B 의 embed/general-LLM 경로 중 일부는 fallback 만으로 자연스럽게 OpenRouter 우세 가능.

---

## 3. 마이그레이션 우선순위 (impact / risk)

| # | 대상 | 새 위치 | impact | risk |
|---|------|---------|--------|------|
| **M1** | action-fill LoRA (`mandala-gen:latest`) | RunPod Serverless | 가장 큼 (wizard 직후 즉시 호출, latency 사용자 체감) | 중간 (LoRA artifact 이동 필요) |
| **M2** | iks-scorer embed | `IKS_EMBED_PROVIDER=openrouter` flip (코드 변경 0) | 작음 | 0 |
| **M3** | video-discover LLM query | OpenRouter (`openRouterApiKey` 이미 인자 받음) | 작음 | 낮음 |
| **M4** | trend-collector LLM extract | OpenRouter | 작음 | 낮음 |
| **M5** | search.ts Haiku fallback | OpenRouter 또는 삭제 | 낮음 | 낮음 |
| **M6** | `prewarmMandalaModel` cron | 삭제 (Mac Mini 종료 시 무의미) | 0 | 0 |
| **M7** | Mac Mini 종료 + Tailscale 정리 | — | (운영비 0 = 전기료 + 라우터 부담만) | 0 |

---

## 4. 단계별 실행 plan

### Phase D1 — M2/M3/M4 (env flip + 1 줄 코드 변경, 총 1 PR)

목적: **embed + 일반 LLM 의존을 Mac Mini 에서 OpenRouter 로 완전 이전**. LoRA 만 남기기.

변경:
1. `docker-compose.prod.yml`:
   - `IKS_EMBED_PROVIDER=openrouter` 추가
2. `src/skills/plugins/video-discover/sources/llm-query-generator.ts`:
   - `DEFAULT_OLLAMA_URL` 제거 — 호출자가 OpenRouter 자격증명 없으면 즉시 throw 하도록
3. `src/skills/plugins/video-discover/executor.ts:501`:
   - `ctx.env?.['OLLAMA_URL'] ?? 'http://100.91.173.17:11434'` → OpenRouter 분기로 교체
4. `src/skills/plugins/trend-collector/sources/llm-extract.ts:24`:
   - 동일

검증:
- 1주일 trickle 후 `[prisma-slow-query]` / Tailscale traffic log 에 Mac Mini 호출 0 확인

롤백: env flip 1 줄 / sed 1 줄.

### Phase D2 — M1 (action-fill LoRA → RunPod Serverless)

가장 중요. 챗봇 RunPod 패턴 (CP449) 그대로 복제.

준비 작업:
1. **LoRA artifact 위치 확인** — 현 Mac Mini Ollama 의 `mandala-gen:latest` 의 base model + LoRA adapter file 위치. `ollama show mandala-gen --modelfile` 으로 추출.
2. **RunPod 컨테이너 빌드** — `worker-vllm` 베이스 + LoRA adapter 마운트. Dockerfile + `start.sh`.
3. **Endpoint 생성** — RunPod dashboard 에서 Serverless endpoint. min_workers=1 (cold-start 1-5s mitigation).
4. **신규 env**:
   - `MANDALA_GEN_PROVIDER=runpod` (default `ollama` 유지)
   - `MANDALA_GEN_RUNPOD_URL=https://api.runpod.ai/v2/<endpoint-id>/...` (또는 기존 `QWEN_LORA_API_URL` 패턴 재사용)
   - GitHub Secrets 에 endpoint 정보 등록 → `deploy.yml` 에서 `.env` 동기화

코드 변경:
- `src/modules/mandala/generator.ts:393-426` (현재 Ollama 호출 부분):
  ```ts
  if (config.mandalaGen.provider === 'runpod') {
    return callRunpodLora(...);  // 신규 함수
  }
  // 기존 Ollama 경로 그대로 (fallback 유지)
  ```
- 신규 `src/modules/mandala/lora-runpod.ts` — RunPod client (POST `/runsync` 또는 OpenAI-compat `/openai/v1/chat/completions`)

검증:
- shadow mode: `MANDALA_GEN_PROVIDER=runpod` 로 dev/local 에서 wizard 1회 만들기 → 64/64 cell action 채워지는지 확인
- prod: 1주 trickle 모니터링 (action fill failure rate, latency p50/p95)

롤백: env flip → Mac Mini Ollama 경로 자동 복귀.

### Phase D3 — M5/M6 (잔여 cleanup)

- `search.ts` 의 Mac Mini fallback path 제거 (이미 OpenRouter 가 우세하면 의미 없음)
- `prewarmMandalaModel` cron 삭제 — LoRA 가 RunPod 으로 가면 prewarm 불필요 (RunPod cold-start 는 worker-side 처리)

### Phase D4 — M7 Mac Mini 종료

prerequisite: Phase D1-D3 모두 prod 무문제 1주 이상.

- prod env 에서 `MANDALA_GEN_URL`, `INSIGHTA_TAILSCALE_IP` 등 Mac Mini 관련 모든 env 제거
- Tailscale 에서 Mac Mini 노드 unauthorize
- 물리 머신 종료 / 회수

---

## 5. 비용 비교 (예상)

### 현재 (Mac Mini 기반)
- Mac Mini 전기료: ~$15/month
- Tailscale 무료
- Mac Mini 운영비용 (사용자 시간): 매 outage 시 수동 복구 ~30분-1시간

### Phase D2 후 (RunPod Serverless + OpenRouter)
- RunPod Serverless (action-fill): GPU billing only-on-use, 우리 traffic (예상 100-500 calls/day × ~2s = 200-1000s/day = ~3-17 min/day GPU time × $0.0004/sec) ≈ **$2-8/month**
- OpenRouter (embed + 일반 LLM): 기존 PR1 / Phase 1 에 흡수, 추가 없음
- **합계 < $10/month**, ops cost = 0 (managed)

→ Mac Mini 종료 후 **사실상 비용 차이 무시 가능**, 안정성 ↑.

---

## 6. 결정 (locked)

| 항목 | 결정 |
|------|-----|
| 마이그레이션 순서 | Phase D1 → D2 → D3 → D4 (1주 간격 검증 후 다음 Phase) |
| LoRA 호스팅 | **RunPod Serverless** (챗봇 패턴 복제, vendor 일관성) |
| Embedding | **OpenRouter `qwen/qwen3-embedding-8b`** (Phase 1 이미 활성) |
| 일반 LLM (video-discover query / trend-collector) | **OpenRouter** (기존 `OPENROUTER_API_KEY` 재사용, 신규 vendor 0) |
| flag 전략 | 각 Phase 마다 env flag 도입 → shadow / canary → flip → 다음 Phase | 

---

## 7. 오픈 사항 (resolved before each Phase 시작)

### Phase D2 시작 전
1. LoRA adapter 파일 (`mandala-gen.safetensors` 등) 의 base model 정확히 무엇? (Qwen-2.5-7B / 3B / 4B 등)
2. RunPod 의 GPU 옵션 (T4 / A10G / A100) 중 cost-quality 어느 것? — Qwen-7B 추론에는 T4 충분, $0.0002/sec
3. LoRA adapter 의 license / 외부 공개 가능성

### Phase D4 시작 전
1. Mac Mini 의 기타 (production 외) 용도 — 개발 환경, 백업 등이 있다면 별 관리

---

## 8. 본 spec 의 메타-원칙

- **단편 fix 금지** (Rule F) — 4 Phase 통합 plan, 각 Phase 가 자체 검증 + 롤백
- **측정 가능성** — Phase D1 의 Mac Mini traffic 0 확인 / D2 의 action fill 64/64 비율 측정
- **Rollback 즉시성** — 각 Phase = env flag flip 으로 환원

---

## 9. Cross-references

- 본 spec 의 origin: hybrid-retrieval spec (PR #611) 의 §4 "Mac Mini 의 기존 LoRA 는 RunPod Serverless 로 마이그레이션 (CP449 챗봇 패턴 복제) 예정"
- 챗봇 RunPod 패턴: commit `2793853` (CP449)
- 본 세션 진단: `docs/reports/wizard-dashboard-diagnosis-2026-05-12.md`
- 관련 env: `MANDALA_GEN_URL`, `MANDALA_EMBED_PROVIDER`, `IKS_EMBED_PROVIDER`, `QWEN_LORA_API_URL`, `RUNPOD_API_KEY` (모두 `src/config/index.ts` 정의됨)
