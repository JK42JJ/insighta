# Chatbot Serving Architecture

> **Status**: Design (CP444, 2026-05-08).
> **Code change**: 0 in this document. Migration in subsequent PRs only.
> **Plan→Approve→Execute (CLAUDE.md)**: this design itself is the approved plan; implementation PRs each require their own approval gate.
> **Related**: `notebooks/insighta-chatbot-lora-qwen3-30b.ipynb` (CP444 LoRA training), `scripts/lora-chatbot/generate-l4-qa.ts` (dataset generator).

---

## §0. Background & Scope

### Current state (verified 2026-05-08, code-cited)

| Aspect | Current |
|---|---|
| Chatbot enum | `'gemini' \| 'openrouter' \| 'local'` (`src/api/routes/copilotkit.ts:7`) |
| Provider read timing | Startup-time, single read (`copilotkit.ts:43-46`); change requires process restart |
| Default in env | `CHATBOT_PROVIDER='openrouter'` → `google/gemini-2.5-flash` (`src/config/index.ts:107-109`) |
| Local path | `CHATBOT_LOCAL_URL=http://localhost:11434/v1` (Ollama OpenAI-compat); prod resolves via `OLLAMA_URL=http://100.91.173.17:11434` (Mac Mini Tailscale, `operations-manual.md`) |
| Adapter | `@copilotkit/runtime` `OpenAIAdapter` only (`copilotkit.ts:3,9`) |
| Runtime config table | **Absent**: no `system_settings` / global config model in `prisma/schema.prisma` (only domain-scoped `youtube_sync_settings`, `newsletter_settings`) |
| Admin route | `src/api/routes/admin/chatbot.ts` GET-only inspection; no PUT/PATCH; `availableProviders: ['gemini','openrouter','local']` (line 12) |
| Region awareness | Frontend `ChatAssistant.tsx:14-22` `ChatContext` (7 fields) + `useLearningStore.ts:21-27` Phase A 6 fields (CP444 LoRA SFT input) |

### Target state (CP444+)

1. **Three new provider modes** for serving the CP444-trained LoRA model alongside Claude and an automatic fallback path.
2. **Hot-swappable** runtime config via DB-backed `system_settings` (no redeploy for provider switch).
3. **Provider-aware prompt builder** so the LoRA model receives its training-format prompt, while Claude receives a natural-language system prompt.
4. **Additive** to existing enum — `gemini` / `openrouter` / `local` retained for current users; new `qwen-lora` / `claude` / `auto` added.

### Out of scope

- Frontend Admin UI (BE contract only here; FE design doc separate).
- Cost monitoring / quota gates beyond what `src/modules/llm/cost-gate.ts` already provides.
- Fine-tuning loop (covered in `notebooks/insighta-chatbot-lora-qwen3-30b.ipynb`).

---

## §1. Provider Modes (3 new)

| Mode | Purpose | Backend | Timeout | Failure |
|---|---|---|---|---|
| `qwen-lora` | Demo / KO-specialized inference | Mac Mini Ollama (`OLLAMA_URL`) **OR** HF Serverless Inference (TBD §6 (a)) | **15 s** | Return error to caller. **No fallback** (intentional — demo mode shows v1 behaviour fidelity). |
| `claude` | Manual switch (Qwen3 down or A/B) | Anthropic API, `claude-haiku-4-5` (cheapest + fastest) | 15 s | Return error. Single-provider mode, no fallback. |
| `auto` | Production default | Claude **primary** + Qwen3 **fallback** | Claude 10 s; Qwen3 15 s | Claude HTTP 5xx **or** timeout 10 s → fallback to Qwen3 (qwen-lora path). If Qwen3 also fails → return error. |

### Notes

- **Naming clarification**: user spec referred to "OLLAMA_HOST"; in Insighta this corresponds to **`OLLAMA_URL`** (`src/config/index.ts:81`, default `http://localhost:11434`) **or** the OpenAI-compat alias **`CHATBOT_LOCAL_URL`** (`src/config/index.ts:107`, default `http://localhost:11434/v1`). `OLLAMA_HOST` proper is the Mac Mini ollama daemon's bind env (CP433 troubleshooting), not used in this backend.
- **`claude-haiku-4-5`** model id assumed; verified at first integration. Anthropic SDK reachability covered in §6 (d).
- **`auto` failover policy**: 5xx **or** timeout 10 s only (4xx → return user-facing error, do not fallback — preserves contract violations).
- **Cool-down**: after a Claude failure triggers fallback, the next N requests still try Claude first (no sticky-fallback). N defaults to 0 (always try primary). Open question §6 (e) for whether to add 1-min cool-down to dampen flap.

---

## §2. Admin Configuration (DB schema + API contract)

**Decision (CP444 user-approved)**: Option A — new generic `system_settings` key-value table.

### §2.1. Prisma model (proposed, additive)

```prisma
/// CP444: generic key-value store for runtime-mutable system config.
/// First user: chatbot_provider hot-swap. Future: feature flags, runtime
/// thresholds. Strictly server-side — never exposed to client.
model system_settings {
  key        String   @id @db.VarChar(64)
  value      String   @db.Text
  /// JSON-encoded metadata: { description, type, updated_by, audit_trail[] }
  meta       Json?
  updated_at DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([updated_at(sort: Desc)], map: "idx_system_settings_updated_at")
  @@schema("public")
}
```

DDL note (CLAUDE.md `prisma db push silent fail` Hard Rule): the PR introducing this model **must** also include `prisma/migrations/system_settings/001_create_table.sql` raw DDL, applied to local **and** prod with `\d system_settings` verification before declaring done.

### §2.2. Initial keys

| Key | Value type | Initial value | Notes |
|---|---|---|---|
| `chatbot_provider` | string enum | `'auto'` (production default per §1) | Allowed: `'qwen-lora' \| 'claude' \| 'auto' \| 'gemini' \| 'openrouter' \| 'local'` (additive — old values retained) |
| `chatbot_qwen_endpoint` | string URL | `OLLAMA_URL` env at boot | Override target host without redeploy. NULL → use env default. |

Future keys (out of scope here): `kg_bridge_threshold`, `wizard_max_concurrency`, etc.

### §2.3. Admin API contract

Extend `src/api/routes/admin/chatbot.ts` (currently GET-only):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/admin/chatbot` | — | `{ provider, model, localUrl, availableProviders, has*Key, source: 'db'\|'env' }` (existing + `source` added) |
| **PUT** (new) | `/api/v1/admin/chatbot/provider` | `{ provider: '...' }` | `{ provider, updated_at, prev_provider }` |
| **GET** (new) | `/api/v1/admin/chatbot/audit` | — | last N changes from `system_settings.meta.audit_trail` |

**Auth**: existing admin guard (`fastify.authenticate` + admin role). Reuse `admin/llm.ts` PUT pattern.

**Cache invalidation**: PUT writes to DB **and** publishes an in-process event (`chatbotProviderChanged`); the `getRuntimeProvider()` helper (§4) listens and invalidates its 30 s cache. Single-process Fastify on EC2 today; if multi-instance later, switch to Redis pub/sub.

### §2.4. Why not env-only (Option B rejected)

- Provider switch requires GitHub Actions deploy (~5–10 min) → can't react to a Qwen3 outage in real time.
- `.env` is **immutable** by Hard Rule (CP358); manual prod-side edits silently revert on next deploy (LEVEL-2 pattern, CP419).

### §2.5. Why not single-row table (Option C rejected)

- Forces per-config schema change (one column per setting). Misses the future-proofing of generic key-value.
- Domain-scoped tables (`youtube_sync_settings`) make sense when bound to a parent FK; chatbot config is process-global.

---

## §3. Prompt Builder Module (new)

### §3.1. Path

**`src/modules/chatbot-rag/prompt-builder.ts`** — directory does not exist today; new module.

### §3.2. Contract

```ts
type Provider = 'qwen-lora' | 'claude' | 'auto' | 'gemini' | 'openrouter' | 'local';

interface BuildPromptInput {
  provider: Provider;             // for 'auto', use the actually-dispatched provider
  chatContext: ChatContext;       // 7 fields, ChatAssistant.tsx:14-22
  regionContext?: RegionContext;  // CP444 Phase A 6 fields, when region-awareness on
}

export function buildSystemPrompt(input: BuildPromptInput): string;
```

### §3.3. Per-provider format

**`qwen-lora`** — match the LoRA SFT format from `scripts/lora-chatbot/convert-to-sft.py`:

```
당신은 영역 인식 학습 도우미입니다. 사용자가 보고 있는 화면 영역과 컨텍스트를 활용해 가장 도움이 되는 답을 제공하세요.

[Region Context]
활성 영역: {active_region}
레이어: {layer}
재생 시각: {mm:ss}
플레이어 상태: {playing|paused|ended|null}
현재 셀: {cell_name}
현재 섹션: {current_section}
메모 선택 텍스트: "{note_selection_text}"
```

Rationale: identical to training data → no distribution shift at inference. Convert-to-sft.py `serialize_region_context()` is the canonical source — prompt-builder.ts imports/duplicates that exact string layout.

**`claude`** — natural-language system prompt:

```
You are an Insighta learning assistant. The user is studying a YouTube video
inside a mandala goal-tree app. Use the following context to ground your
answer in their current view:

- Mandala: {mandala_name} (id={mandala_id})
- Current cell: {cell_name or "—"}
- Current video: {video_id}
- Current section: {current_section or "—"}
{if region-aware:}
- The user is currently looking at: {layer} (region: {active_region})
- Player state: {player_state} at {mm:ss}
{if note_selection_text:}
- They have selected this text in their notes: "{note_selection_text}"

Respond concisely (under 200 tokens) and reference the context fields when
relevant.
```

**`gemini` / `openrouter` / `local` (legacy)**: keep current behaviour — minimal system prompt + `useCopilotReadable` injection from `ChatAssistant.tsx`. Do NOT route through the new builder; this preserves bit-exact parity for users on the legacy path.

### §3.4. ChatContext + Region usage matrix

| Field | qwen-lora | claude | legacy |
|---|---|---|---|
| `layer` (6-enum) | ✓ | ✓ | via `useCopilotReadable` |
| `mandala_id` / `mandala_name` | ✓ | ✓ | via `useCopilotReadable` |
| `cell_name` / `cell_index` | ✓ | ✓ | via `useCopilotReadable` |
| `video_id` | ✓ | ✓ | via `useCopilotReadable` |
| `current_section` | ✓ | ✓ | via `useCopilotReadable` |
| Phase A `active_region` / `player_time_sec` | ✓ (6→4 normalize for `player_state`) | ✓ (full state) | not used |
| Phase A `note_selection_text` / `note_draft_excerpt` | ✓ (selection only) | ✓ (selection only) | not used |

Player-state normalization (CP444 Plan §1 D2): `buffering`/`unstarted`/`cued` → `null` for `qwen-lora` only (matches SFT prep). Claude path uses the raw 6-state.

---

## §4. Serving Dispatch (`copilotkit.ts` refactor)

### §4.1. Shape

Pseudocode (illustrative; final PR will diff against the current 82-line file):

```ts
async function getRuntimeProvider(): Promise<Provider> {
  // 30 s in-memory cache, invalidated on chatbotProviderChanged event
  const cached = providerCache.get();
  if (cached) return cached;

  const row = await prisma.system_settings.findUnique({
    where: { key: 'chatbot_provider' },
  });
  const provider = (row?.value ?? config.chatbot.provider) as Provider;
  providerCache.set(provider, 30_000);
  return provider;
}

async function dispatch(req, res) {
  const provider = await getRuntimeProvider();

  switch (provider) {
    case 'qwen-lora':
      return serveOllama(req, res, { timeoutMs: 15_000, fallback: false });
    case 'claude':
      return serveClaude(req, res, { timeoutMs: 15_000, fallback: false });
    case 'auto':
      return serveAuto(req, res); // Claude 10s timeout → Qwen3 fallback
    // legacy paths unchanged
    case 'gemini':
    case 'openrouter':
    case 'local':
      return serveLegacyOpenAIAdapter(req, res, provider);
  }
}
```

### §4.2. Migration approach (additive — CP444 user-approved)

**Existing enum retained**: `'gemini' | 'openrouter' | 'local'` continues to work. The full enum (§2.2) accepts both old and new values. No deprecation in this PR.

**OpenAIAdapter compatibility**: legacy paths already use `OpenAIAdapter` from `@copilotkit/runtime`. New `qwen-lora` reuses the same adapter (Ollama exposes OpenAI-compat `/v1`). **`claude` is the open question** — `OpenAIAdapter` may or may not work against Anthropic's API. See §6 (d).

### §4.3. Auto-mode failover state machine

```
[idle] --request--> [try Claude]
  ok                      ↓
  ←------ response ←------
                          ↓ 5xx OR timeout 10s
                     [try Qwen3]
                          ↓ ok → response
                          ↓ fail → 503 to caller
```

Metrics to log per request: `provider_chosen`, `fallback_triggered` (bool), `latency_ms`, `failure_reason` if any. Reuse `src/modules/llm/call-logger.ts` pattern.

### §4.4. Cache + concurrency

- `providerCache` is a single in-process module-level variable; safe for single-instance Fastify.
- DB lookup (`prisma.system_settings.findUnique({ where: { key: 'chatbot_provider' } })` is PK lookup, sub-ms).
- 30 s TTL cap on stale config; PUT-driven invalidation gives ≤ 1 s effective propagation in practice.

---

## §5. Don't Touch (frozen contracts)

| # | Frozen | Reason |
|---|---|---|
| 1 | `ChatContext` 7-field type (`ChatAssistant.tsx:14-22`) | Renaming breaks SFT data + `useCopilotReadable` consumers. Field additions OK; renames forbidden. |
| 2 | `useLearningStore` Phase A 6 fields (`useLearningStore.ts:21-27`) | LoRA training data was generated against this exact shape; rename invalidates SFT distribution. |
| 3 | `.env` files (`/Users/jeonhokim/cursor/insighta/.env*`) | CLAUDE.md absolute Hard Rule (CP358). All env mutation via GitHub Secrets + `deploy.yml`. |
| 4 | CopilotKit GraphQL endpoint structure (`copilotRuntimeNodeHttpEndpoint`, `OpenAIAdapter`) | Frontend `@copilotkit/react-core` expects this exact runtime shape. |
| 5 | Anthropic / OpenRouter API direct calls from scripts (CLAUDE.md 2026-04-15 Hard Rule) | Production adapter only. Scripts/tests use CC console (Write tool) for synthetic data. |
| 6 | Legacy enum values (`'gemini' \| 'openrouter' \| 'local'`) | Existing users; additive-only migration per §4.2. |

---

## §6. Open Questions

### (a) HF Serverless Inference vs Mac Mini Ollama for `qwen-lora`

**Decision criteria** (to be measured before §7 Phase 3 deploy):

| Axis | Mac Mini Ollama | HF Serverless |
|---|---|---|
| Latency p50 | TBD measure (LAN-ish via Tailscale) | TBD measure (cloud, region us-west) |
| Cold start | None (warm daemon) | Possible 5–30 s on first req per inactivity window |
| Cost | $0 (existing hardware) | per-token billing |
| Uptime SLO | Mac Mini reboot = full outage | HF managed |
| Model size limit | 30B QLoRA fits ~22 GB; OK | Depends on tier |

Default recommendation: Mac Mini Ollama until measurable Mac Mini downtime; HF as warm-standby for `auto`-mode fallback OR for paid tiers where SLO matters.

### (b) Qwen3 streaming via Ollama `/api/chat` SSE

Ollama supports streaming (`stream: true`); CopilotKit `OpenAIAdapter` expects OpenAI SSE chunk format (`data: {...}\n\n`). Compatibility verified at integration time, not assumed.

### (c) Admin UI scope

Out of scope for this BE design. FE design doc separate (proposed file: `docs/design/admin-chatbot-ui.md`). MVP = single dropdown bound to PUT `/api/v1/admin/chatbot/provider`.

### (d) Claude Haiku-4-5 adapter compatibility

**Critical**: CopilotKit's `OpenAIAdapter` is OpenAI-API-shaped. Anthropic's REST API differs (request body, streaming format, auth header `x-api-key`). Two integration paths to evaluate before §7 Phase 4:

1. **OpenAI-compat shim**: third-party adapters or custom `OpenAIAdapter` subclass that translates request/response. Risk: behavioural drift.
2. **Direct `@anthropic-ai/sdk`**: bypass `OpenAIAdapter` for the `claude` branch entirely. Implement a custom CopilotKit `ServiceAdapter` interface against Anthropic SDK. Higher implementation cost; cleaner contract.

**Required action (CP444, user-flagged)**: design doc explicitly notes that **`@anthropic-ai/sdk` direct usage is a likely path** — `OpenAIAdapter` may not cover Anthropic. Decision deferred to §7 Phase 4 spike. `package.json` will need `@anthropic-ai/sdk` added in that PR.

### (e) Auto-mode cool-down after failover

After Claude returns 5xx and traffic falls back to Qwen3, should the next request still try Claude first (current proposal) or stick on Qwen3 for N minutes to dampen flap? Initial answer: try Claude every time (no stickiness). Re-evaluate after first incident.

---

## §7. Migration Path

| Phase | Scope | Rollback flag | Estimated PRs |
|---|---|---|---|
| **1** | Add `system_settings` table (Prisma + raw DDL) + extend `admin/chatbot.ts` PUT route + extend enum (additive) | New rows simply absent → falls back to env | 1 |
| **2** | Refactor `copilotkit.ts` to request-time provider read with 30 s cache; legacy paths unchanged | `system_settings.chatbot_provider` not set → env default | 1 |
| **3** | Deploy `qwen-lora` path (Ollama OpenAI-compat dispatch, prompt-builder.ts new); requires CP444 LoRA model on HF / Ollama | `system_settings.chatbot_provider != 'qwen-lora'` (don't pick) | 1 |
| **4** | Deploy `claude` path; Anthropic SDK adapter spike (§6 (d)); add `claude-haiku-4-5` model | `system_settings.chatbot_provider != 'claude'` | 1–2 (spike + impl) |
| **5** | Deploy `auto` path with failover; metrics logging | `system_settings.chatbot_provider != 'auto'` | 1 |

Each phase merges independently. Phases 3–5 may reorder based on measured priorities.

---

## §8. Decision Log

| # | Decision | Rationale |
|---|---|---|
| D1 | system_settings = generic key-value table (Option A) | CP444 user-approved 2026-05-08; future-proof for runtime config beyond chatbot. |
| D2 | Provider enum = additive (legacy retained) | CP444 user-approved 2026-05-08; preserves existing behaviour, zero-risk migration. |
| D3 | qwen-lora has no fallback (intentional) | Demo-mode fidelity; mirrors training-distribution behaviour exactly. |
| D4 | auto-mode fallback trigger = 5xx OR 10 s timeout | CP444 plan; 4xx kept opaque to caller (contract violations are not transient). |
| D5 | Player-state 6→4 normalization in qwen-lora prompt only | CP444 Plan §1 D2; matches LoRA SFT preparation in `convert-to-sft.py`. |
| D6 | Claude integration may require `@anthropic-ai/sdk` direct usage | CP444 user-flagged 2026-05-08; CopilotKit `OpenAIAdapter` not assumed compatible with Anthropic API. Spike in Phase 4. |
| D7 | Cache TTL 30 s + PUT-driven invalidation | Trades 1 DB read / 30 s for sub-1-s effective propagation; safe for single-instance Fastify. |

---

## Appendix A — Cited code locations (verified 2026-05-08)

| Citation | File:line |
|---|---|
| Current chatbot enum | `src/api/routes/copilotkit.ts:7` |
| Startup-time provider read | `src/api/routes/copilotkit.ts:43-46` |
| Chatbot env schema | `src/config/index.ts:107-109` |
| Chatbot config map | `src/config/index.ts:253-258` |
| Ollama URL config | `src/config/index.ts:81` |
| Chatbot local URL config | `src/config/index.ts:107` |
| `OllamaGenerationProvider` | `src/modules/llm/ollama.ts` |
| Admin chatbot GET route | `src/api/routes/admin/chatbot.ts:6-17` |
| Admin LLM PUT route (pattern reference) | `src/api/routes/admin/llm.ts:48` |
| `ChatContext` 7 fields | `frontend/src/pages/learning/ui/ChatAssistant.tsx:14-22` |
| Phase A region store | `frontend/src/pages/learning/model/useLearningStore.ts:21-27` |
| `computeChatLayer` | `frontend/src/pages/learning/ui/ChatAssistant.tsx:27-48` |
| LoRA SFT region serializer (qwen-lora prompt source) | `scripts/lora-chatbot/convert-to-sft.py` `serialize_region_context()` |
| Region awareness flag | `frontend/src/pages/learning/ui/ChatAssistant.tsx:24-25` (`VITE_CHATBOT_REGION_AWARENESS`) |

## Appendix B — Cross-references

- CP358: `.env` immutability (CLAUDE.md Hard Rule).
- CP383: prisma db push silent fail (raw DDL parallel mandatory).
- CP392: non-secret config not in Secrets (`chatbot_provider` as DB row, not Secret).
- CP419: prod manual edit silently reverted by deploy (rationale to avoid env-only Option B).
- CP444 LoRA dataset pipeline: `scripts/lora-chatbot/generate-l4-qa.ts`, `convert-to-sft.py`, `notebooks/insighta-chatbot-lora-qwen3-30b.ipynb`.
- CLAUDE.md 2026-04-15 LLM-API-call Hard Rule: scripts/tests must not call Anthropic / OpenRouter; this design's runtime path is the production adapter (allowed).
