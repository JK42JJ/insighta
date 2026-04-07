# Insighta Skill Plugin Architecture

> **Status**: v1 — design (no code yet)
> **Owner**: JK
> **Created**: 2026-04-07 (CP352)
> **Issue**: #366 (closes — Phase 0 follow-up to #358)
> **Hard prerequisite for**: #358 Phase 1+ (trend-collector, IKS-scorer, video-discover, recommendation-tuner)

## 1. Background

오늘날 Insighta의 스킬은 모두 `src/modules/skills/*.ts`에 평면적으로 살고 있습니다 (newsletter, research-report, alert, recommend, video-script, blog-post, video-discover-stub). 등록은 `src/modules/skills/index.ts`에서 한 줄씩 import + `skillRegistry.register(new XxxSkill())`. SkillRegistry는 `skill_runs` 테이블 로깅 + tier × quota 가드만 담당합니다 (`src/modules/skills/registry.ts`).

이 평면 구조는 6개 스킬까지는 잘 동작했지만, 다음과 같은 한계가 드러나고 있습니다:

- **소유권 부재** — 어떤 스킬이 어떤 테이블에 write할 수 있는지 컨벤션이 없음
- **3-stage lifecycle 부재** — preflight 검증, execute 본체, deliver 후처리(메일/푸시/Webhook)가 한 함수에 섞임
- **스킬 간 import 가능** — 컴파일러가 막지 않음. 향후 100개 스킬에서 의존성 그래프 폭발 위험
- **manifest 메타데이터 없음** — cron, event trigger, 의존 테이블, 외부 API 키 요구사항이 코드 안에 흩어짐
- **Temporal/VOC 통합 지점 미정의** — 신뢰가 필요한 write(`scoring_weights` 가중치 변경 등)가 admin 승인 없이 직접 INSERT 가능

#358 트렌드 추천 엔진은 5-Layer 파이프라인 + 3개 신규 스킬(trend-collector, video-discover, recommendation-tuner)을 도입하면서 위 한계가 임계점에 도달합니다. **Phase 1 진입 전 plugin 규격을 먼저 못박아 두는 것이 본 문서의 목적입니다.**

본 문서는 **신규 스킬의 규격**을 정의하며, 기존 7개 평면 스킬의 일괄 마이그레이션은 **하지 않습니다** (§7 마이그레이션 정책 참조).

## 2. 3-Layer Architecture 개요

```
┌────────────────────────────────────────────────────────────────────┐
│  Layer A — SkillRegistry (in-process)                              │
│    · skill 등록/탐색/실행/skill_runs 로깅 (현존 src/modules/skills) │
│    · cron + 단순 event 트리거                                       │
│    · 신뢰성 요구가 낮은 일회성 작업                                  │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ heavy / long / retryable
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer B — Temporal (workflow runtime, 별도 프로세스)               │
│    · trend-collector, IKS-scorer 같은 멀티 단계 + 재시도 + idempotency│
│    · workflow durability + activity retry                          │
│    · 도입 시점: Phase 1 trend-collector부터 (이번 #358 sprint)       │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ sensitive write (weights, tier change, …)
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Layer C — VOC (Voice-of-Change, admin 승인 파이프라인)              │
│    · scoring_weights 변경, billing tier 변경, schema migration 제안 │
│    · 7일 review window + admin sign-off → 그제서야 prod write       │
│    · 도입 시점: Phase 6 recommendation-tuner부터                    │
└────────────────────────────────────────────────────────────────────┘
```

**핵심 원칙**: 한 스킬은 자기에게 적합한 가장 낮은 Layer에 머문다. Layer 승격은 필요할 때만.

| 스킬 종류                              | 권장 Layer | 사례                                       |
| -------------------------------------- | ---------- | ------------------------------------------ |
| 빠른 read-only 컨텍스트 빌드           | A          | recommend (LLM 지식격차)                    |
| LLM 호출 + 단일 outbound (메일 1건)    | A          | newsletter, research-report, alert          |
| 외부 API 멀티 호출 + 재시도 + 누적 쓰기 | B          | trend-collector, IKS-scorer, video-discover |
| 사용자 신뢰가 걸린 write               | C          | recommendation-tuner (가중치 제안)          |

## 3. SkillManifest

플러그인의 메타데이터. 코드는 manifest를 export 하고, 등록 시점에 SkillRegistry/Temporal/VOC가 manifest를 읽어 라우팅을 결정합니다.

```typescript
// src/skills/_shared/types.ts (Phase 1에서 신설)
import type { JSONSchema7 } from 'json-schema';
import type { Tier } from '@/config/quota';

export type SkillTrigger =
  | { type: 'manual' }
  | { type: 'cron'; schedule: string }                 // e.g. '0 3 * * *'
  | { type: 'event'; event: SkillEventName };

export type SkillEventName =
  | 'mandala.created'
  | 'mandala.updated'
  | 'card.added'
  | 'dashboard.viewed'
  | 'weights.proposed'
  | 'admin.approved';

export type SkillLayer = 'A' | 'B' | 'C';

export interface SkillTableAccess {
  /** Tables this skill is allowed to READ. Anything else throws at runtime. */
  read: string[];
  /** Tables this skill is allowed to WRITE. Tables not in this list are forbidden. */
  write: string[];
}

export interface SkillExternalDependency {
  /** Symbolic name (matches credentials.md row). */
  name: string;
  /** Required env var key. Missing → preflight fails. */
  env: string;
  /** True if the skill cannot run at all without this. False = degraded mode OK. */
  required: boolean;
}

export interface SkillManifest {
  /** Stable kebab-case identifier, used for routing + skill_runs.skill_id */
  id: string;
  version: string;                          // semver, e.g. '1.0.0' or '0.1.0-beta'
  description: string;                      // one-line, user-visible
  layer: SkillLayer;                        // A | B | C — see §2
  trigger: SkillTrigger;
  tiers: readonly Tier[];                   // who can run this
  inputSchema: JSONSchema7;                 // Claude Tool Use compatible
  tables: SkillTableAccess;                 // hard ownership boundary
  dependencies?: SkillExternalDependency[]; // external API keys, etc.
  /** True if a single execution is safe to retry without side effects. */
  idempotent: boolean;
  /** Optional: maximum concurrent executions per user. Default 1. */
  maxConcurrentPerUser?: number;
}
```

**왜 이런 필드인가**

- `layer` — 한 줄로 라우팅 결정 (A/B/C)
- `tables.write` — 스킬이 자기 영역 밖에 INSERT/UPDATE 시 SkillRegistry가 차단 (런타임 가드)
- `dependencies` — Phase 1 trend-collector가 `NAVER_CLIENT_ID` 없이 시작될 때 preflight가 명확히 fail
- `idempotent` — Temporal이 재시도해도 안전한지 컴파일러가 알 수 있게 함

## 4. SkillExecutor — 3-Stage Lifecycle

플러그인의 실행 본체. 한 함수가 아니라 **세 단계로 분리**합니다.

```typescript
// src/skills/_shared/types.ts
export interface PreflightContext {
  userId: string;
  mandalaId?: string;
  tier: Tier;
  /** All env vars resolved at boot, frozen reference */
  env: Readonly<Record<string, string | undefined>>;
}

export interface PreflightResult {
  ok: boolean;
  /** If ok=false, this becomes the skill_runs.error. */
  reason?: string;
  /** Optional: fields the executor will hand to execute() */
  hydrated?: Record<string, unknown>;
}

export interface ExecuteContext extends PreflightContext {
  llm: GenerationProvider;          // existing src/modules/llm/provider.ts
  /** Hydrated state from preflight (immutable). */
  state: Record<string, unknown>;
}

export interface ExecuteResult {
  status: 'success' | 'partial' | 'failed';
  data: Record<string, unknown>;    // becomes skill_runs.output
  /** Rows the executor wants delivered (e.g. recommendations to push). */
  deliverables?: Deliverable[];
  metrics?: {
    duration_ms: number;
    llm_tokens_used?: number;
    rows_written?: Record<string, number>;
  };
}

export interface Deliverable {
  channel: 'inapp' | 'email' | 'webhook' | 'none';
  payload: Record<string, unknown>;
}

export interface DeliverContext {
  result: ExecuteResult;
  userId: string;
}

export interface SkillExecutor {
  manifest: SkillManifest;
  /** Cheap, side-effect-free. Validates inputs, env, quota. */
  preflight(ctx: PreflightContext): Promise<PreflightResult>;
  /** Heavy work. Writes only to manifest.tables.write. */
  execute(ctx: ExecuteContext): Promise<ExecuteResult>;
  /** Side-channel delivery (mail/push/webhook). NEVER writes to DB. */
  deliver?(ctx: DeliverContext): Promise<void>;
}
```

**3-stage 분리의 이유**

| Stage      | 격리 원칙                                                       |
| ---------- | -------------------------------------------------------------- |
| `preflight` | side-effect 없음 → Temporal에서 자유롭게 재실행 가능, fail-fast |
| `execute`  | manifest 선언 테이블만 write, deliverables는 *반환*만 한다       |
| `deliver`  | DB 일체 손대지 않음 → 메일 실패가 데이터 정합성을 깨지 못하게 함  |

이 분리가 Layer B(Temporal) 도입 시 그대로 Activity 3개로 매핑됩니다.

## 5. Plugin Folder Layout

```
src/skills/
├── _shared/
│   ├── types.ts            ← SkillManifest, SkillExecutor, ExecuteResult …
│   ├── runtime.ts          ← table-ownership guard, manifest validator
│   └── __tests__/
│       └── runtime.test.ts
└── plugins/
    ├── trend-collector/
    │   ├── manifest.ts     ← export const manifest: SkillManifest
    │   ├── executor.ts     ← export const executor: SkillExecutor
    │   ├── sources/
    │   │   ├── youtube.ts
    │   │   └── naver.ts
    │   └── __tests__/
    │       ├── manifest.test.ts
    │       ├── executor.preflight.test.ts
    │       └── executor.execute.test.ts
    ├── video-discover/
    │   ├── manifest.ts
    │   ├── executor.ts
    │   └── __tests__/
    └── recommendation-tuner/
        ├── manifest.ts
        ├── executor.ts
        └── __tests__/
```

**규칙**:

1. 한 플러그인 = 한 디렉토리. 디렉토리 이름 = `manifest.id`.
2. `manifest.ts`는 export만 한다. 어떤 코드도 실행하지 않는다 (등록 시점에 부수효과 금지).
3. 플러그인의 모든 코드는 자기 디렉토리 안에서만 import 가능. 예외는 `_shared/`와 `@/modules/...`(비-스킬 코드)뿐.
4. `__tests__/`는 디렉토리 단위로 강제. 신규 플러그인은 manifest 1 + executor 2 (preflight, execute) 최소 3 테스트.

## 6. Hard Rules (절대 위반 금지)

1. **No cross-plugin imports**
   `src/skills/plugins/A/*` 는 `src/skills/plugins/B/*` 를 import 할 수 없다. ESLint rule + CI grep으로 강제.

2. **Table ownership boundary**
   런타임에 `manifest.tables.write`에 없는 테이블에 INSERT/UPDATE 시 SkillRegistry가 throw. Prisma client wrapper가 이 검증을 수행.

3. **Sensitive write → VOC only**
   다음 테이블은 어떤 plugin도 직접 write 할 수 없다. 오직 Layer C(VOC 승인 후) 만 write 가능:
   - `scoring_weights` (가중치 버전)
   - `users.tier` (billing)
   - `auth.*` (Supabase auth schema 전체)
   - `mandala_subscriptions.tier` (구독 등급)

4. **Manifest is immutable at runtime**
   `manifest.ts` export 후 어떤 코드도 manifest 객체를 수정할 수 없다. `Object.freeze()` 강제.

5. **Idempotency declared, not assumed**
   `manifest.idempotent` 플래그를 명시해야 Temporal이 retry 결정을 할 수 있다. 기본값 없음 — 누락 시 preflight 단계에서 reject.

6. **Preflight has zero side effects**
   `preflight()`는 read-only 여야 한다. DB write, 외부 API call 모두 금지. 입력 검증 + env 체크 + quota 조회만 허용.

7. **Plugin tests are mandatory before registration**
   `_shared/runtime.ts`의 `validateManifest()`가 `__tests__/manifest.test.ts` 존재 여부를 boot 시점에 확인 (dev 환경만, prod skip). 누락 시 boot fail.

## 7. Migration Policy (기존 평면 스킬)

**원칙**: **마이그레이션 없음** (Big-bang rewrite 금지). 기존 7개 평면 스킬은 그대로 유지하고, **신규 스킬만 plugin 규격으로 작성**한다.

| 스킬                         | 위치                                | 처리                          |
| ---------------------------- | ----------------------------------- | ----------------------------- |
| newsletter                   | `src/modules/skills/newsletter.ts`  | 유지 (Layer A, 동작 검증됨)    |
| research-report              | `src/modules/skills/research-report.ts` | 유지                       |
| alert                        | `src/modules/skills/alert.ts`       | 유지                          |
| recommend                    | `src/modules/skills/recommend.ts`   | 유지                          |
| video-script                 | `src/modules/skills/video-script.ts`| 유지                          |
| blog-post                    | `src/modules/skills/blog-post.ts`   | 유지                          |
| video-discover (BETA stub)   | `src/modules/skills/video-discover.ts` | **삭제** (Phase 3에서 plugin 출시 시) |
| trend-collector (Phase 1)    | `src/skills/plugins/trend-collector/` | **신규 — plugin 규격**       |
| video-discover (Phase 3)     | `src/skills/plugins/video-discover/`  | **신규 — plugin 규격**       |
| recommendation-tuner (Phase 6) | `src/skills/plugins/recommendation-tuner/` | **신규 — plugin 규격** |

**SkillRegistry는 양쪽 모두 등록 가능**해야 한다. plugin 규격은 어댑터를 거쳐 기존 `InsightaSkill` 인터페이스로 변환된 뒤 registry에 등록된다 (§9 등록 흐름 참조).

기존 7개 스킬을 plugin 규격으로 옮기는 작업은 **별도 epic**으로 처리하되, **본 #358 sprint에는 포함하지 않는다**. 개별 스킬에 손댈 일이 생기면 그때 그 스킬만 plugin으로 옮긴다 (점진적 대체).

## 8. Hello-World Plugin Example

신규 플러그인의 최소 형태. 이 코드만 있으면 등록 + 실행 가능.

```typescript
// src/skills/plugins/hello-world/manifest.ts
import type { SkillManifest } from '@/skills/_shared/types';

export const manifest: SkillManifest = Object.freeze({
  id: 'hello-world',
  version: '1.0.0',
  description: 'Smoke-test plugin — returns the user id and current time.',
  layer: 'A',
  trigger: { type: 'manual' },
  tiers: ['free', 'pro', 'lifetime', 'admin'],
  inputSchema: {
    type: 'object',
    properties: {
      greeting: { type: 'string', default: 'hello' },
    },
    required: [],
  },
  tables: { read: [], write: [] },
  idempotent: true,
}) satisfies SkillManifest;
```

```typescript
// src/skills/plugins/hello-world/executor.ts
import type { SkillExecutor, PreflightResult, ExecuteResult } from '@/skills/_shared/types';
import { manifest } from './manifest';

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx): Promise<PreflightResult> {
    if (!ctx.userId) return { ok: false, reason: 'userId is required' };
    return { ok: true, hydrated: { startedAt: Date.now() } };
  },

  async execute(ctx): Promise<ExecuteResult> {
    const startedAt = ctx.state.startedAt as number;
    return {
      status: 'success',
      data: { userId: ctx.userId, greeting: 'hello' },
      metrics: { duration_ms: Date.now() - startedAt },
    };
  },

  // deliver omitted — no side-channel delivery for hello-world
};
```

```typescript
// src/skills/plugins/hello-world/__tests__/manifest.test.ts
import { manifest } from '../manifest';

describe('hello-world manifest', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('declares Layer A and idempotent', () => {
    expect(manifest.layer).toBe('A');
    expect(manifest.idempotent).toBe(true);
  });

  it('owns no tables', () => {
    expect(manifest.tables.write).toEqual([]);
  });
});
```

## 9. Registration Flow

신규 plugin은 기존 SkillRegistry로 흘러들어와야 합니다 (UI/quota/`skill_runs` 로깅 인프라 재사용). 어댑터를 통해 `SkillExecutor` → `InsightaSkill`로 변환합니다.

```typescript
// src/skills/_shared/registry-adapter.ts (Phase 1 신설)
import { skillRegistry } from '@/modules/skills';
import type { InsightaSkill } from '@/modules/skills/types';
import type { SkillExecutor } from './types';
import { wrapPluginAsSkill } from './wrap';

export function registerPlugin(executor: SkillExecutor): void {
  const adapted: InsightaSkill = wrapPluginAsSkill(executor);
  skillRegistry.register(adapted);
}
```

```typescript
// src/skills/index.ts (Phase 1 신설 — 모든 plugin 등록 단일 진입점)
import { registerPlugin } from './_shared/registry-adapter';
import { executor as helloWorld } from './plugins/hello-world/executor';
// import { executor as trendCollector } from './plugins/trend-collector/executor';

registerPlugin(helloWorld);
// registerPlugin(trendCollector);
```

이 한 줄(`import './skills'`)을 server boot에서 호출하면 모든 plugin이 등록됩니다. `src/modules/skills/index.ts`(평면 7개 등록)는 그대로 유지되며, 둘이 공존합니다.

## 10. Layer 승격 (A → B → C)

스킬은 **Layer A로 시작**하고, 다음 trigger 충족 시 다음 Layer로 승격합니다. 승격은 코드 변경 + 별도 PR 단위.

| 승격                  | trigger 조건                                      | 작업                                                            |
| --------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| A → B (Temporal)      | (a) 외부 API 멀티 호출 (b) 5분+ long-running (c) 중간 실패 시 재시도 필요 | executor 그대로, Temporal Workflow가 preflight/execute/deliver를 Activity로 호출 |
| B → C (VOC)           | sensitive table write 필요                         | execute()는 *제안만* 생성 (VOC 테이블에 INSERT), VOC가 admin 승인 후 prod write |

**현재 #358 Phase 1~6의 분류**:

- `trend-collector`: A → **B 즉시 시작** (외부 API + 멀티 단계 + idempotency 필요)
- `IKS-scorer`: B (계산 무거움, retry 안전)
- `video-discover` (Phase 3): A → 데이터 양 증가 시 B 검토
- `recommendation-tuner` (Phase 6): **C 즉시 시작** (가중치 변경은 sensitive)

## 11. Open Questions

### Q1. Temporal 클러스터 어디에 띄울까
- 현재 EC2 t2.micro 단일 인스턴스. Temporal Server는 메모리 1GB+ 필요.
- 옵션 (a) Temporal Cloud (paid, ~$200/mo for starter)
- 옵션 (b) EC2 인스턴스 업그레이드 (t3.small → ~$20/mo) + self-host
- 옵션 (c) Phase 1을 일단 Layer A(in-process)로 시작하고 Temporal은 Phase 2~3으로 미루기
- **잠정 권장**: (c) — Layer A에서 cron + try/catch로 출발, 안정화 후 Temporal 도입. trend-collector preflight/execute/deliver 분리 자체는 지금 적용해두면 마이그레이션 비용 거의 없음.

### Q2. Table-ownership guard 구현 위치
- Prisma client wrapper로 만들면 tsc가 못 잡고 런타임에만 throw
- 옵션 (a) Prisma extension (`$extends`)으로 model마다 캡처
- 옵션 (b) 별도 DAO 레이어 강제 + lint rule
- **잠정 권장**: (a), Prisma extension. CP352 이후 별도 PR.

### Q3. ESLint cross-plugin import rule
- `eslint-plugin-import/no-restricted-paths` 로 zone 정의 가능
- 도입 시점: Phase 1 첫 plugin이 만들어지는 PR에서 함께

### Q4. `_shared/runtime.ts`의 `validateManifest()` 강도
- dev에서 boot fail 강제 vs warning만
- **잠정 권장**: dev=fail, test=fail, prod=warning + Sentry alert

## 12. Acceptance (#366)

- [x] Doc created at `docs/design/insighta-skill-plugin-architecture.md`
- [x] SkillManifest type 정의 (§3)
- [x] SkillExecutor 3-stage interface (§4)
- [x] Plugin folder layout (§5)
- [x] Hard rules — cross-import 금지, table 소유권, VOC 강제 (§6)
- [x] 3-Layer architecture A/B/C 활성화 시점 (§2, §10)
- [x] Migration policy (§7) — 기존 7개 유지 + 신규만 plugin
- [x] Hello-world example (§8)
- [x] Reviewed against `docs/design/skill-registry-handoff.md` (기존 평면 스킬 패턴과 충돌 없이 공존)
- [ ] 본 문서에 따라 #358 신규 3개 스킬이 작성되었는가 — Phase 1~6 진행 중 verify

## 13. References

- `docs/design/skill-registry-handoff.md` — 기존 SkillRegistry 디자인 (Layer A 본체)
- `docs/design/insighta-trend-recommendation-engine.md` — #358 Phase 0 design doc, §9 plugin 인용
- `src/modules/skills/registry.ts` — 현행 SkillRegistry 구현
- `src/modules/skills/types.ts` — 현행 `InsightaSkill` 인터페이스
- `docs/policies/skill-quota-policy.md` — quota 가드 정책
- Issue #358 (Epic), #359~#365 (Phase 1~7), #366 (이 문서)
