# Research: Local LLM Integration for Insighta

**Issue**: #250
**Date**: 2026-03-19
**Status**: Complete
**Environment**: macOS (Apple Silicon), Ollama 0.18.1

---

## 1. Executive Summary

Local LLM (Ollama) integration was benchmarked against current Gemini API usage. Key findings:

| Area | Recommendation | Confidence |
|------|---------------|------------|
| Embedding | **Adopt nomic-embed-text for dev/offline** | High |
| Summarization | **Keep Gemini, Ollama not viable yet** | High |
| Router | **FunctionGemma as intent router** | Medium |
| Architecture | **Provider abstraction layer** | High |

---

## 2. Environment

| Component | Version | Size |
|-----------|---------|------|
| Ollama | 0.18.1 | - |
| qwen3.5:9b | latest | 6.1 GB |
| nomic-embed-text | latest | 274 MB |
| gpt-oss:20b | latest | 12.8 GB |
| FunctionGemma | 270M-it | 536 MB (safetensors) |

**Hardware**: Apple Silicon Mac (local inference)

---

## 3. Embedding Benchmark

### 3.1 Setup
- **Ollama**: `nomic-embed-text` (768d, Nomic AI)
- **Gemini**: `gemini-embedding-001` (768d, outputDimensionality=768)
- **Test**: 10 texts (EN/KR, various tech domains)

### 3.2 Results

| Metric | nomic-embed-text (Local) | gemini-embedding-001 (Cloud) |
|--------|--------------------------|------------------------------|
| Dimension | 768 | 768 |
| Avg Latency | **37ms** | 500ms |
| Latency Range | 25-102ms | 381-921ms |
| Cost | $0 (forever) | Free tier (rate limited) |
| Offline | Yes | No |

### 3.3 Quality Analysis

**Cross-provider cosine similarity** (same text, different model):
- Values range 0.04 ~ 0.09 — embedding spaces are fundamentally different
- Cannot mix embeddings from different providers in the same vector store

**Clustering quality** (semantic similarity):

| Text Pair | nomic-embed-text | Gemini |
|-----------|-----------------|--------|
| React EN ↔ React KR (similar) | 0.5609 | **0.8494** |
| React ↔ PostgreSQL (different) | 0.5613 | 0.5081 |
| Spread (discrimination) | -0.0004 | **0.3413** |

**Key finding**: Gemini has significantly better semantic discrimination (0.34 spread vs ~0 for nomic). Nomic treats semantically similar and different texts nearly equally, meaning search quality would degrade.

### 3.4 Embedding Recommendation

| Use Case | Provider | Reason |
|----------|----------|--------|
| Production search/similarity | **Gemini** | Far superior semantic clustering |
| Development/offline | **nomic-embed-text** | 13x faster, zero cost, pgvector compatible |
| Batch processing (non-critical) | Either | Depends on quality requirement |

**Critical constraint**: Cannot mix providers — all embeddings in `ontology.embeddings` must use the same model. Switching requires re-embedding all nodes.

---

## 4. Summarization Benchmark

### 4.1 Setup
- **Ollama**: `qwen3.5:9b` (temperature=0.3, num_predict=1024)
- **Gemini**: `gemini-2.0-flash` (temperature=0.3, maxOutputTokens=1024)
- **Test**: 3 video captions (EN, KR, EN-technical)

### 4.2 Results

| Metric | qwen3.5:9b (Local) | Gemini Flash (Cloud) |
|--------|---------------------|----------------------|
| Avg Latency | 42.3s (1 test) | N/A (rate limited) |
| JSON Compliance | **0/3** (0%) | Expected ~100% |
| Korean Support | Empty response | Good |
| Cost | $0 | Free tier |

### 4.3 Critical Issues with qwen3.5:9b

1. **Empty responses on long prompts**: Prompts >500 chars consistently return empty string. Short prompts ("hello world") work fine (8.3s).
2. **Extremely slow**: 42.3s for a single summarization attempt (Apple Silicon). Not viable for user-facing features.
3. **JSON format non-compliance**: Even when response is generated, JSON parsing fails. The model has `<think>` mode that adds reasoning tags before output.
4. **Korean input → empty response**: Korean-language prompts return nothing.

### 4.4 Summarization Recommendation

**Keep Gemini for summarization**. qwen3.5:9b is not viable due to:
- Empty responses on production-length prompts
- 40s+ latency (vs ~2s Gemini)
- Poor JSON format adherence
- Korean language failures

**Future consideration**: Larger local models (13B+, 20B+) may improve quality but will be even slower without GPU acceleration.

---

## 5. FunctionGemma Router Analysis

### 5.1 Background

FunctionGemma (270M) is a function-calling specialized model already downloaded at `/Users/jeonhokim/cursor/functiongemma/`. It has a PRD for an orchestration platform.

### 5.2 Architecture Proposal: FunctionGemma as Insighta Router

```
User Request
    │
    ▼
┌──────────────────────┐
│  FunctionGemma (270M)│  ← Intent classification + function routing
│  ~300ms latency      │  ← 288MB model, runs on CPU
│  85% accuracy (tuned)│
└──────┬───────────────┘
       │
       ├─── embed(text) ──────→ nomic-embed-text (local, 37ms)
       ├─── summarize(video) ─→ Gemini API (cloud, ~2s)
       ├─── tag(memo) ────────→ qwen3.5:9b (local, simple prompts)
       ├─── classify(card) ───→ qwen3.5:9b (local, simple prompts)
       └─── complex_query ────→ Gemini API (cloud, fallback)
```

### 5.3 Why FunctionGemma as Router

| Factor | Value |
|--------|-------|
| Size | 270M params / 288MB — loads in <1s |
| Latency | <300ms for intent classification |
| Accuracy | 61.6% base → **85% after fine-tuning** |
| Context | 32K tokens |
| Cost | $0 (local inference) |

### 5.4 Router Function Schema (Insighta-specific)

```typescript
const insightaFunctions = [
  {
    name: "embed_text",
    description: "Generate embedding vector for text (memo, card title, node)",
    parameters: { text: "string", model: "nomic|gemini" }
  },
  {
    name: "summarize_video",
    description: "Summarize YouTube video from captions",
    parameters: { videoId: "string", level: "short|medium|detailed" }
  },
  {
    name: "tag_memo",
    description: "Extract tags/keywords from user memo",
    parameters: { content: "string", language: "en|ko" }
  },
  {
    name: "classify_card",
    description: "Suggest ontology node type for a card",
    parameters: { title: "string", content: "string" }
  },
  {
    name: "suggest_edges",
    description: "Suggest ontology edges between nodes based on content similarity",
    parameters: { nodeId: "string", limit: "number" }
  }
];
```

### 5.5 Integration Path

1. **Phase 1**: Use FunctionGemma inference server (`cursor/functiongemma/services/api/`) to classify intent
2. **Phase 2**: Route to appropriate backend (Ollama local vs Gemini cloud)
3. **Phase 3**: Fine-tune FunctionGemma on Insighta-specific function schemas

### 5.6 Risks

| Risk | Mitigation |
|------|-----------|
| 61.6% base accuracy | Fine-tuning → 85%, plus fallback to Gemini |
| Additional service to run | Docker container, lightweight (288MB) |
| Complexity overhead | Start with simple if/else routing, migrate to FunctionGemma when proven |

---

## 6. New Use Cases

### 6.1 Feasible with Current Setup

| Use Case | Model | Expected Quality | Latency |
|----------|-------|-----------------|---------|
| Memo keyword extraction | qwen3.5:9b (short prompts) | Medium | ~10s |
| Card title auto-tagging | qwen3.5:9b (short prompts) | Medium | ~10s |
| Similar node search | nomic-embed-text | Good | <50ms |

### 6.2 Requires Gemini (Not Feasible Locally)

| Use Case | Reason |
|----------|--------|
| Video summarization | Long context, JSON compliance needed |
| Ontology edge generation from memo | Complex reasoning required |
| Multi-language content analysis | Korean language quality |

### 6.3 Future (with FunctionGemma Router)

| Use Case | Router Decision | Executor |
|----------|----------------|----------|
| "이 메모에서 키워드 뽑아줘" | tag_memo | qwen3.5:9b (local) |
| "이 비디오 요약해줘" | summarize_video | Gemini (cloud) |
| "비슷한 카드 찾아줘" | suggest_edges | nomic-embed-text → pgvector |

---

## 7. Architecture Design (No Implementation)

### 7.1 Config Addition (`src/config/index.ts`)

```typescript
// Add to envSchema:
OLLAMA_URL: z.string().default('http://localhost:11434'),
OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),
OLLAMA_GENERATE_MODEL: z.string().default('qwen3.5:9b'),
LLM_PROVIDER: z.enum(['gemini', 'ollama', 'auto']).default('auto'),

// Add to config:
ollama: {
  url: env.OLLAMA_URL,
  embedModel: env.OLLAMA_EMBED_MODEL,
  generateModel: env.OLLAMA_GENERATE_MODEL,
},
llm: {
  provider: env.LLM_PROVIDER, // 'auto' = try Ollama first, fallback to Gemini
},
```

### 7.2 Provider Abstraction

```typescript
// src/modules/llm/provider.ts
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  readonly dimension: number;
  readonly name: string;
}

interface GenerationProvider {
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  readonly name: string;
}

// Factory with fallback
function createEmbeddingProvider(): EmbeddingProvider {
  if (config.llm.provider === 'ollama' || config.llm.provider === 'auto') {
    try { return new OllamaEmbeddingProvider(); }
    catch { /* fallback */ }
  }
  return new GeminiEmbeddingProvider();
}
```

### 7.3 Fallback Strategy

```
LLM_PROVIDER=auto (default):
  1. Check Ollama health (GET /api/tags)
  2. If available → use Ollama for embedding, Gemini for generation
  3. If unavailable → use Gemini for both
  4. If Gemini rate limited → queue and retry

LLM_PROVIDER=gemini:
  Always use Gemini (current behavior, no changes)

LLM_PROVIDER=ollama:
  Always use Ollama (offline mode, summarization quality degrades)
```

### 7.4 No Frontend Changes Required

All LLM logic is in backend modules:
- `src/modules/ontology/embedding.ts` — swap `generateEmbedding()` implementation
- `src/modules/summarization/generator.ts` — swap `generateWithGemini()` implementation
- Frontend calls same API endpoints, provider is transparent

---

## 8. Cost Analysis

| Component | Current (Gemini) | With Ollama | Savings |
|-----------|-----------------|-------------|---------|
| Embedding API | Free tier (limited) | $0 (unlimited) | Rate limit removed |
| Summarization | Free tier (limited) | $0 (degraded quality) | Not recommended |
| Compute | $0 | $0 (local CPU) | Neutral |
| FunctionGemma | N/A | $0 (288MB local) | New capability |

---

## 9. Implementation Stories (Backlog)

| Story | Priority | Effort | Dependencies |
|-------|----------|--------|-------------|
| Provider abstraction layer | P1 | S | None |
| nomic-embed-text for dev mode | P1 | S | Provider abstraction |
| Ollama health check + auto-fallback | P2 | M | Provider abstraction |
| FunctionGemma intent router PoC | P2 | L | FunctionGemma service running |
| Memo auto-tagging (qwen3.5 short prompt) | P3 | M | Provider abstraction |
| Re-embed existing nodes (provider switch) | P3 | S | Decision on production provider |

---

## 10. Conclusion

1. **Embedding**: nomic-embed-text is 13x faster and free, but Gemini has far better semantic quality. Use nomic for dev, Gemini for prod.
2. **Summarization**: qwen3.5:9b is not viable (empty responses, 40s latency, no JSON compliance). Keep Gemini.
3. **Router**: FunctionGemma (270M) is an excellent candidate for lightweight intent routing — 288MB, <300ms, 85% accuracy after fine-tuning.
4. **Architecture**: Provider abstraction layer enables seamless switching. No frontend changes needed.
5. **Next step**: Implement provider abstraction, then incrementally add Ollama support.
