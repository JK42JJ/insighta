# Chatbot Failover Redesign — Background Poller Pattern (CP477+14)

**날짜**: 2026-05-22  
**상태**: Design (사용자 승인 대기)  
**대상 commit**: main HEAD `ec1ca049` (CP477+13 nginx fix + CP477+11 failover revert 적용된 상태)  
**관련 PR**: (구현 PR 작성 후 추가)

---

## 1. 배경 (Background)

### 1.1 사용자 demand

- `bec5sptl1a5f8d-8000.proxy.runpod.net` (RunPod Pod) 가 stop / migration 으로 죽었을 때 chatbot 이 **자동으로 OpenRouter Gemini 2.5 Flash 로 전환**되어 응답이 끊기지 않아야 한다.
- 사용자가 3 회 명시 요구한 spec 이다.

### 1.2 직전 시도 와 실패 이력

| PR | 날짜 | 시도 | 결과 |
|---|---|---|---|
| #720 (CP477+3) | 2026-05-20 | `getYoga()` 안에서 `await isQwenRunpodHealthy()` 호출 → 첫 req 시 health probe | 사용자 `Invalid JSON payload` 400 보고 → 원인 = raw HTTP `req.pause()` 전 에 `await` 가 'data'/'end' event 사이에 fire 되어 body lost |
| #729 (CP477+6) | 2026-05-21 | PR #720 통째로 revert (baseline `bc45d901` 으로 rollback). prod chatbot 정상 동작 확인 (66 success log) | failover 완전 제거 → "Pod 죽으면 chatbot 도 down" |
| #732 (CP477+7) | 2026-05-21 | raw HTTP listener 의 first line 에 `req.pause()` 추가 → `await getYoga()` 후 `req.resume()`. body buffer 보존 | 단독으로는 OK (사용자 dev 정상 응답 image #54) |
| #737 (CP477+11) | 2026-05-21 | PR #720 의 failover 를 다시 추가 (race-fix 의 paused window 안에서 가설). `resolveEffectiveProvider` async hop 을 `req.pause()`/`req.resume()` 사이에 위치 | **prod 다시 `Invalid JSON payload` 400 storm + BE log `Request stream consumed with no available body; sending empty payload.` × 5+**. paused window 가 second async hop (health probe ~50-500ms) 을 흡수 못 함. |
| #740 (CP477+12) | 2026-05-22 | PR #737 revert (failover 다시 제거) + nginx `Connection 'upgrade'` 도 fix (#739) | warning storm 해결 + `Invalid JSON payload` 사라짐. 단 Pod 죽으면 자동 전환 없음 (직전 fact: Pod `/health` 404). |

### 1.3 진짜 root cause (재확인)

- 사용자 image (2026-05-22 03:12) 의 `[CopilotKit] sendMessage error: Not Found Error: Not Found` × 12+
- `curl https://bec5sptl1a5f8d-8000.proxy.runpod.net/health` = 404 (Pod 자체 down 상태)
- 즉 race-fix / failover 무관, **Pod down 이 root cause**. 단 demo 동안 / 평소 운영 중 Pod 가 죽으면 chatbot 도 같이 down — 그래서 failover 가 spec.

### 1.4 PR #737 가 실패한 정확한 이유

PR #737 commit message 의 가설:

> "PR #732's `req.pause()` window absorbs both delays."

prod BE log fact 반박:

```
[16:18:34] Request stream consumed with no available body; sending empty payload.
[16:18:45] Request stream consumed with no available body; sending empty payload.
[16:19:02] Request stream consumed with no available body; sending empty payload.
[16:19:08] Request stream consumed with no available body; sending empty payload.
[16:21:58] Request stream consumed with no available body; sending empty payload.
```

→ paused window 안에 second async hop (500ms health probe) 추가 시 `isStreamConsumed(req)` 가 true 가 되어 yoga 의 single-route helpers 가 빈 body 로 `parseMethodCall` 시도 → 400.

근본 문제 = **request handler path 안에 async hop 이 있으면 어떤 race-fix 로도 100% 해결 안 됨**.

---

## 2. 새 design — Background poller pattern

### 2.1 핵심 idea

> **Request handler 안에 health probe 를 넣지 말고, 별도 background interval 로 health 상태를 폴링해서 module-level state 에 cache 한다. Request handler 는 그 state 를 read-only 로 읽는다 (no await).**

```
┌─────────────────────────────────────────────────────────────────┐
│   background poller (setInterval, 5s)                             │
│   ┌───────────────────────┐                                      │
│   │ isQwenRunpodHealthy() │ ─────► effectiveProvider 변경 시      │
│   └───────────────────────┘        invalidate lazyYoga             │
│              │                                                    │
│              ▼                                                    │
│   ┌──────────────────────────────┐                                │
│   │ effectiveProvider (module-level)│   ◄── read by handler       │
│   └──────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ read only, no await
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│   server.on('request') — raw HTTP listener (CP477+7 race-fix)    │
│   req.pause();                                                    │
│   void (async () => {                                             │
│     const handler = await getYoga();   // ← 이 안에 health probe   │
│     req.resume();                       //    없음, just settings   │
│     await handler(req, res);                                      │
│   })();                                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 PR #737 와의 차이

| 항목 | PR #737 (실패) | 본 design (CP477+14) |
|---|---|---|
| Health probe 위치 | `getYoga()` 안 (per-request, await) | `setInterval` 안 (background, periodic) |
| Request handler 안 await hop | settings + health (2개) | settings (1개) |
| Provider 전환 latency | 즉시 (다음 request) | 0-5초 (poller interval) |
| Race-fix paused window 안 async hop | 2개 (race 발생) | 1개 (race 없음, PR #732 가 검증한 시점과 동일) |
| Rollback path | 코드 revert PR 만 | env flag OFF (즉 — 빠른 revert path) |

### 2.3 핵심 안전성 보장

1. **`getYoga()` 안 async hop 수 = PR #732 (race-fix 검증된 baseline) 과 동일하게 유지** → race 재현 불가
2. **Provider 전환 latency 0-5초** 는 사용자 spec 에 부합 (Pod migration ~3-5분 소요 대비 충분히 빠름)
3. **module-level `effectiveProvider` 는 read 가 atomic** (JavaScript 의 single-threaded model) → race 없음

---

## 3. Rollback path (사용자 directive)

**핵심: env flag default OFF. 코드 revert 없이 flag toggle 만으로 즉 — 바로 disable 가능.**

### 3.1 Flag spec

| 변수 | type | default | 의미 |
|---|---|---|---|
| `CHATBOT_FAILOVER_ENABLED` | bool | **`false`** | `true` 시에만 background poller 활성. `false` 시 = 현재 main HEAD `ec1ca049` 동작 100% 동일 (failover 없음) |

### 3.2 활성화 (flag ON, 내일 demo 검증 후)

```bash
gh variable set CHATBOT_FAILOVER_ENABLED --body "true"
gh workflow run deploy.yml --ref main -f reason="enable failover after dev verify"
# ~5 분 후 prod 에 적용. Pod down 시 OpenRouter 자동 전환 시작.
```

### 3.3 롤백 (flag OFF, 내일 문제 발생 시)

```bash
# Option A — env flag toggle (권장, ~5분)
gh variable set CHATBOT_FAILOVER_ENABLED --body "false"
gh workflow run deploy.yml --ref main -f reason="rollback failover — issue X observed"

# Option B — code revert PR (~15-20분)
# 본 design 의 구현 commit revert
```

### 3.4 default OFF 의 의미

- 구현 PR 머지 시점 prod 영향 = **0** (코드는 들어가지만 활성 안 됨)
- 사용자가 명시적으로 flag ON 할 때까지 = current behavior 100% 동일
- 사용자 직전 사고 이력 (PR #720, PR #737) 의 root cause = "default ON 으로 모든 사용자 영향" → 본 design 은 그것 차단

---

## 4. Implementation outline

### 4.1 새 파일 — `src/api/routes/copilotkit-provider-poller.ts` (~80 lines)

```ts
import { logger } from '@/utils/logger';
import { config } from '@/config/index';
import { isQwenRunpodHealthy } from './copilotkit-health';
import type { ChatbotProvider } from './copilotkit-model-resolver';

const POLLER_INTERVAL_MS = 5_000;

let pollerTimer: NodeJS.Timeout | null = null;
let effectiveProvider: ChatbotProvider | null = null;
let onProviderChange: (next: ChatbotProvider) => void = () => {};

/** Snapshot read. Safe to call from request handler. No await. */
export function getEffectiveProvider(): ChatbotProvider {
  if (!config.chatbot.failoverEnabled) return config.chatbot.provider;
  return effectiveProvider ?? config.chatbot.provider;
}

/** Wire up the poller. Caller passes a cb that yoga rebuild logic. */
export function startProviderHealthPoller(
  onChange: (next: ChatbotProvider) => void,
): void {
  if (!config.chatbot.failoverEnabled) {
    logger.info('chatbot failover poller disabled (flag OFF)');
    return;
  }
  if (config.chatbot.provider !== 'qwen-runpod') {
    logger.info('chatbot failover poller skipped (provider != qwen-runpod)');
    return;
  }
  onProviderChange = onChange;
  effectiveProvider = config.chatbot.provider;

  const tick = async (): Promise<void> => {
    try {
      const healthy = await isQwenRunpodHealthy(config.qwenLora.apiUrl);
      const next: ChatbotProvider = healthy ? 'qwen-runpod' : 'openrouter';
      if (next !== effectiveProvider) {
        logger.info('chatbot failover transition', {
          from: effectiveProvider,
          to: next,
          reason: healthy ? 'pod recovered' : 'pod unreachable',
        });
        effectiveProvider = next;
        onProviderChange(next);
      }
    } catch (err) {
      logger.warn('chatbot failover poller error (continuing)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // fire once immediately + on interval
  void tick();
  pollerTimer = setInterval(() => void tick(), POLLER_INTERVAL_MS);
  logger.info('chatbot failover poller started', { intervalMs: POLLER_INTERVAL_MS });
}

/** For tests + graceful shutdown. */
export function stopProviderHealthPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
  effectiveProvider = null;
}
```

### 4.2 `src/api/routes/copilotkit.ts` 수정 (~20 lines net)

```diff
+ import { getEffectiveProvider, startProviderHealthPoller } from './copilotkit-provider-poller';

  async function getYoga(): Promise<YogaHandler> {
    const settings = await getChatbotSettings();
+   const provider = getEffectiveProvider();  // read only, no await
    if (
      !lazyYoga ||
      settings.updatedAt.getTime() > lazyBuildAt ||
+     provider !== lazyBuiltProvider
    ) {
-     const model = resolveChatbotModel(config.chatbot.provider, ...);
-     const serviceAdapter = createServiceAdapter(config.chatbot.provider, model);
+     const model = resolveChatbotModel(provider, ...);
+     const serviceAdapter = createServiceAdapter(provider, model);
      // ... build yoga ...
+     lazyBuiltProvider = provider;
    }
    return lazyYoga;
  }

  export const copilotKitRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
+   // CP477+14 — start background failover poller (no-op if flag OFF)
+   startProviderHealthPoller((next) => {
+     // invalidate lazy yoga so next request rebuilds with new provider
+     lazyYoga = null;
+     lazyBuiltProvider = null;
+     lazyBuildAt = 0;
+   });
    // ... rest unchanged ...
  };
```

### 4.3 `src/config/index.ts` 수정 (~5 lines)

```diff
  chatbot: {
    provider: ...,
+   failoverEnabled: z.coerce.boolean().default(false), // env: CHATBOT_FAILOVER_ENABLED
  },
```

### 4.4 `.github/workflows/deploy.yml` 수정 (~3 lines)

env block + envs list + sed write 3-block pattern (CP475+1 같은 pattern):

```diff
  env:
+   CHATBOT_FAILOVER_ENABLED: ${{ vars.CHATBOT_FAILOVER_ENABLED || 'false' }}
  ...
```

---

## 5. Verification plan

### 5.1 Pre-merge (구현 PR CI)

- [ ] BE `npx tsc --noEmit` clean
- [ ] FE `npx tsc --noEmit` clean (FE 무관, 자동 통과)
- [ ] 새 단위 테스트: `tests/api/copilotkit-provider-poller.test.ts`
  - mocked `isQwenRunpodHealthy` 로 healthy/unhealthy transition 검증
  - `onChange` callback 호출 횟수 + provider 값 검증
  - timer cleanup 검증 (memory leak 방지)
- [ ] 통합 테스트: flag OFF 시 `getEffectiveProvider()` 가 `config.chatbot.provider` 그대로 반환
- [ ] Hardcode Audit / Lint / Test Frontend pass

### 5.2 Post-merge (default OFF — prod 영향 0)

- [ ] `curl prod /api/v1/chat -d '{"method":"info"}'` = 현재와 동일 응답 (flag OFF 라서 변화 없어야)
- [ ] 사용자 image refresh 시 chatbot 동작 = 변화 없음
- [ ] BE log 에 `chatbot failover poller disabled (flag OFF)` 1줄 (flag OFF 확인)

### 5.3 Flag ON 시 (내일 demo 직전 검증, 사용자 확인 후)

- [ ] `gh variable set CHATBOT_FAILOVER_ENABLED=true` + redeploy
- [ ] BE log 에 `chatbot failover poller started { intervalMs: 5000 }` 1줄
- [ ] Pod alive 상태 — chatbot 정상 응답
- [ ] Pod stop simulation (사용자 콘솔 stop) → 5-10초 후 BE log `chatbot failover transition { from: qwen-runpod, to: openrouter, reason: pod unreachable }` → 다음 chat → OpenRouter Gemini 응답
- [ ] Pod restart → 5-10초 후 BE log `chatbot failover transition { from: openrouter, to: qwen-runpod, reason: pod recovered }` → 다음 chat → Qwen LoRA 응답

### 5.4 Demo 시 문제 발생 시 rollback

- [ ] `gh variable set CHATBOT_FAILOVER_ENABLED=false` + redeploy → 5분 후 prod 가 flag OFF = current main 동작 (변화 없음)
- [ ] code revert 불필요

---

## 6. Out of scope (future)

- nginx upstream group + passive health check 으로 proxy-layer failover. 더 robust 단 nginx config 복잡 — 본 PR 후 별도 PR.
- CopilotKit `CopilotRuntime` 의 `agents` registry 등록 → `Agent default not found` warning 별 fix. 단 warning storm 은 PR #739 (nginx fix) + PR #740 (failover revert) 으로 이미 해결 (사용자 image 3.12 = 0 warnings).
- Cohere reranker / Gemini-1.5-flash 의 failover (별 module).
- Admin UI 에 live `effective` provider 상태 표시.

---

## 7. References

- `src/api/routes/copilotkit.ts` — 본 PR 의 main edit target
- `src/api/routes/copilotkit-health.ts` — `isQwenRunpodHealthy` 재사용 (이미 main 에 존재, dead code)
- `docs/runbook/cp477+6-chatbot-rollback-handoff-2026-05-21.md` — baseline `bc45d901` fact + 어제 incident 의 정확한 cause
- `docs/runbook/runpod-pod-id-rotation-fast-deploy.md` — Pod URL 변경 시 GH variable + deploy 절차
- `memory/credentials.md` — `QWEN_LORA_API_URL` / `RUNPOD_API_KEY` / `CHATBOT_PROVIDER` 정의
- PR #737 commit `843e7213` — 실패한 시도 (참고)
- PR #740 commit `ec1ca049` — current main HEAD (failover revert)

---

**Status**: Awaiting user approval. After approval → implementation PR (branch `feat/chatbot-failover-poller-cp477+14`).
