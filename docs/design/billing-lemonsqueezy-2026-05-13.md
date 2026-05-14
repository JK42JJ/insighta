# Lemon Squeezy 결제 통합 — Design Doc

> **Version**: v1 (2026-05-13)
> **Scope**: Lemon Squeezy (이하 LS) test mode 로 pro_monthly 정기결제 MVP. lifetime 일회성 + pro_annual 은 Phase 2 defer.
> **Author session**: CP456 (CP455 carryover, launch 2일 전 사용자 요청)
> **Status**: DRAFT — Phase 0 design doc, 사용자 review 후 Phase 1 (DB) 진행
> **Supersedes**: `docs/design/recurring-billing-2026-04-22.md` (Toss + PayPal 전제, 폐기)

---

## §0 Mission — 거짓 없이 (CP415 + CP456 IT)

**목표 (이 세션)**: LS test store + test API key 로 (a) pro_monthly 정기결제 + (b) cancel/portal + (c) webhook 수신 → DB 동기화 end-to-end 동작. 모든 숫자는 LS dashboard 또는 prod DB 쿼리 실측만 인용.

**비목표 (defer)**:
- Live 키 전환 (별도 ADR + ops runbook)
- pro_annual / lifetime (Phase 2)
- 환불 셀프서비스 UI (admin 수동)
- 쿠폰 / 프로모션 / trial period
- 한국 부가세 영수증 customization (LS Merchant-of-Record 가 자동 처리)

**성공 기준 (실측 가능, 이론치 금지)**:
1. test 카드 `4242 4242 4242 4242` 로 checkout URL 결제 → LS dashboard 에 order/subscription row 생성 확인
2. LS webhook `subscription_created` 수신 → BE signature 검증 PASS → `billing_subscriptions` row INSERT (실측: `SELECT * FROM billing_subscriptions WHERE user_id = ...`)
3. user `user_subscriptions.tier` = `'free'` → `'pro'` 자동 승급 (실측: 동일 row before/after)
4. FE `/mypage` 에서 ACTIVE plan + next_billing_at 표시
5. LS customer portal 에서 cancel → webhook `subscription_cancelled` → DB `status='CANCELLED'`, `cancel_at_period_end=true`, `tier` 다음 주기까지 `pro` 유지
6. Signature 변조 webhook → 401 + log entry, DB 무변화

**거짓 없음 운영 정의**: 결제 숫자 (성공률, latency) 는 LS dashboard / DB 쿼리만 인용. 이론값은 `(LS docs 미확인)` 명시.

**LS docs 접근 상태** (2026-05-13 측정): `docs.lemonsqueezy.com/help/getting-started/test-mode` WebFetch 403 (인증 페이지). 본 doc 는 LS 공개 API 일반 패턴 (Bearer token, HMAC-SHA256 signature, hosted checkout) 기반. **API 키 수령 시점에 실제 API 응답으로 가설 검증 후 본 doc v2 업데이트**.

---

## §1 Current State

### 1.1 이미 존재하는 관련 자산

| 파일 | 역할 | 본 설계 처분 |
|------|------|--------------|
| `prisma/schema.prisma:1432` `payment_transactions` | Stripe 전용 (`stripe_payment_id`, `stripe_invoice_id`, `currency='usd'`) | **건들지 않음.** row count 0 확인 후 컬럼 확장 검토 (Phase 2). 즉시는 신규 테이블만. |
| `prisma/schema.prisma:732` `user_subscriptions` | `user_id @unique` + `tier` + limits. 결제 메타데이터 0 | **건들지 않음.** webhook handler 가 `tier` 컬럼만 update. |
| `src/api/routes/admin/payments.ts` | Stripe scaffold (`STRIPE_SECRET_KEY` 미설정 시 503) | `-legacy/` 이동 + `@deprecated` JSDoc (ADR-1). 라우트 등록 제거. |
| `src/api/routes/subscriptions.ts` | user-to-user mandala follow, **결제 무관** | 건들지 않음. 이름 충돌 회피 위해 신규 route 는 `/api/v1/billing/*`. |
| `frontend/src/shared/config/subscription-tiers.ts` | free 150/3 · pro 1k/20 · lifetime ∞/∞ · admin ∞/∞ | 건들지 않음. plan_code → tier 매핑 (별도 상수 신설). |
| `docs/design/recurring-billing-2026-04-22.md` | 토스 + PayPal 전제 | **SUPERSEDED 마커** header 추가 (CLAUDE.md 삭제 금지). |

### 1.2 왜 Lemon Squeezy 단독인가

- **Merchant of Record**: VAT/Sales tax/한국 부가세를 LS 가 자동 정산. 토스+PayPal 이중 경로 + 분기별 환율 수동 갱신 (구 설계 ADR-13) 불필요.
- **단일 API + 단일 webhook**: provider abstraction layer 불필요 (YAGNI, 구 설계 ADR-3 동일 정책).
- **Hosted Checkout**: PCI compliance LS 책임, BE 의 카드 데이터 핸들링 0.
- **글로벌 한 번에**: 한국/해외 region 분기 (구 설계 ADR-11) 폐기. region-aware UI 도 일단 제거.

---

## §2 Decision Log (ADR)

### ADR-1: 기존 Stripe scaffold 처분 — `-legacy/` 이동
- **선택**: `src/api/routes/admin/payments.ts` → `src/api/routes/admin/payments.legacy.ts`, route 등록 제거, `@deprecated` 표시.
- **이유**: LS 단독 확정. CLAUDE.md "컴포넌트 삭제 금지 → `-legacy/` + `@deprecated`" 준수.
- **롤백**: 파일명 원복 + route 재등록.

### ADR-2: Checkout 방식 = Hosted Checkout URL Redirect
- **선택**: LS hosted checkout URL 을 BE 에서 발급, FE 가 `window.location.href` redirect.
- **이유**: FE 의 LS JS SDK 의존성 0, PCI scope 0. LS overlay JS 보다 단순.
- **거부 대안**: Overlay JS — FE bundle +N KB, SDK 호환성 추적 비용.

### ADR-3: Provider 추상화 없음 (YAGNI)
- **선택**: `src/modules/billing/` 는 LS 전용. `provider` 컬럼은 두지만 enum 분기 없음 (`'lemonsqueezy'` 상수).
- **이유**: 2nd provider 요구사항 없음. 추상화는 2nd provider 도입 시점에 refactor.

### ADR-4: Webhook signature 검증 필수
- **선택**: 모든 webhook 수신은 `X-Signature` 헤더 HMAC-SHA256 검증 (raw body + `LEMONSQUEEZY_WEBHOOK_SECRET`). 실패 시 401 + log + no DB write.
- **이유**: 결제 상태 조작 방지.
- **구현 주의**: Fastify body parser 가 raw body 보존하도록 `addContentTypeParser('application/json', { parseAs: 'buffer' })` 별도 hook 등록 — 이 webhook route 한정.

### ADR-5: Webhook idempotency = `billing_events` 테이블 + unique constraint
- **선택**: 모든 webhook event 를 `billing_events.provider_event_id` unique 로 저장. 중복 event 는 INSERT conflict → no-op.
- **이유**: LS 가 동일 event 를 재전송 가능 (네트워크 장애 시). 멱등 보장.

### ADR-6: 결제 스케줄러 = LS 가 처리, Insighta 는 webhook 만
- **선택**: 정기결제 cron 자체 구현 0. LS 가 다음 주기에 자동 청구 → webhook `subscription_payment_success` 수신 → DB `current_period_end` 갱신.
- **이유**: 구 설계 ADR-6 (토스 자체 스케줄러 부재) 가 LS 에서는 무효. LS 는 자체 정기결제 엔진 보유.

### ADR-7: 결제 실패 처리 = LS dunning 위임
- **선택**: LS 의 자동 retry / dunning email 사용. Insighta 는 `subscription_payment_failed` webhook 만 받아 status 갱신.
- **이유**: 결제 실패 retry 정책 (1h / 24h / 72h grace 등) 의 자체 구현 비용 회피.

### ADR-8: Customer Portal = LS hosted
- **선택**: 사용자 plan 변경 / 결제 수단 변경 / cancel 모두 LS portal URL 로 redirect. Insighta UI 는 status 표시 + portal 진입 버튼만.
- **이유**: portal UI 자체 구현 비용 회피, LS 가 카드 정보 보유 → security boundary 명확.

### ADR-9: 환경 분리 = test/live 키 공존, store 단위
- **선택**: `.env` 에 `LEMONSQUEEZY_API_KEY` (test 또는 live), `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_STORE_ID`. test/live store 별도, 키 prefix 로 구분.
- **이유**: LS test mode = store-level toggle (LS docs 미확인, 키 수령 시 검증).

### ADR-10: Plan 카탈로그 = pro_monthly + pro_yearly (MVP, 확정 2026-05-13 v1.3)
- **선택**: Phase 1 부터 variant 2개 활성:
  - `pro_monthly` — LS variant `1648440`, $9.99 USD/month
  - `pro_yearly` — LS variant `1648443`, 가격은 LS dashboard 에서 사용자 결정 (webhook `amount_cents` 로 동적 수신)
  - 둘 다 `tier='pro'` 동일 한도. 차이는 billing 주기만.
- **이유**: 사용자 LS dashboard 에 variant 2개 모두 생성 완료 (2026-05-13). monthly only 부터 시작 vs 처음부터 양쪽 — variant 가 둘 다 ready 이므로 추가 비용 0, plan-catalog 만 확장.
- **결과**: `src/modules/billing/plan-catalog.ts` 의 `getCatalog()` 가 2개 entry 반환. `checkout` route 의 `planCode` enum = `'pro_monthly' | 'pro_yearly'`.
- **부가세**: LS Merchant of Record → 한국 부가세 (10%) 자동 정산.
- **lifetime (LS one-time order)**: Phase 2 defer (별도 product/variant + `order_created` webhook 처리).

### ADR-11: Plan → tier 매핑 = LS variant_id → 내부 plan_code → tier
- **선택**: `src/modules/billing/plan-catalog.ts` 에 static map `{ variantId: 'NNNN', planCode: 'pro_monthly', tier: 'pro', cardLimit: 1000, mandalaLimit: 20 }`. variant_id 는 LS dashboard 에서 사용자 직접 생성 후 .env 또는 본 파일에 주입.
- **이유**: LS variant 정보는 source of truth, 내부 plan_code + tier 는 codebase 상수.

### ADR-12: tier 자동 승급 = webhook handler 가 `user_subscriptions.tier` 갱신
- **선택**: webhook `subscription_created`/`_updated`/`_cancelled`/`_resumed`/`_expired` 수신 시 `user_subscriptions.tier` 컬럼 update. 기존 row 없으면 INSERT, 있으면 UPDATE.
- **이유**: 단일 column 변경. 신규 모델 분리하지 않음.
- **주의**: cancel 시 `tier='pro'` 유지 (current_period_end 까지). expire 시점에 `'free'` 로 강등.

---

## §3 Architecture — Layer Map (Cross-Layer Propagation 준수)

### L0 — Database

**신규 테이블 2개**. raw SQL DDL 병행 (CLAUDE.md "prisma db push Silent Fail" LEVEL-3 준수).

**실제 migration**: [`prisma/migrations/billing/001_billing_subscriptions.sql`](../../prisma/migrations/billing/001_billing_subscriptions.sql) + [`prisma/migrations/billing/002_billing_events.sql`](../../prisma/migrations/billing/002_billing_events.sql). 아래 SQL 블록은 컬럼 구조 reference 이며, 실제 적용 SQL 과 다음 점이 다름:
- `status` enum 대신 **text + CHECK constraint** (Prisma schema 에 기존 enum 0건 — codebase convention 유지). Phase 1.1 실측 결과 (2026-05-13).
- `updated_at` 자동 갱신 trigger 추가 (`billing_subscriptions_set_updated_at()` 함수).

```sql
-- prisma/migrations/billing/001_billing_subscriptions.sql
CREATE TYPE billing_subscription_status AS ENUM (
  'PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAUSED'
);

CREATE TABLE public.billing_subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                 text NOT NULL DEFAULT 'lemonsqueezy',
  provider_subscription_id text NOT NULL UNIQUE,    -- LS subscription id
  provider_customer_id     text,                    -- LS customer id (portal URL 발급용)
  variant_id               text NOT NULL,           -- LS variant id
  plan_code                text NOT NULL,           -- 'pro_monthly' 등 내부 코드
  status                   billing_subscription_status NOT NULL DEFAULT 'PENDING',
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  cancelled_at             timestamptz,
  amount_cents             integer NOT NULL,        -- LS 가 정한 금액 (currency 기준)
  currency                 char(3) NOT NULL,        -- 'USD' / 'KRW' 등
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_subscriptions_user ON billing_subscriptions(user_id);
CREATE INDEX idx_billing_subscriptions_status ON billing_subscriptions(status)
  WHERE status IN ('ACTIVE', 'PAST_DUE');
CREATE UNIQUE INDEX idx_billing_subscriptions_user_active
  ON billing_subscriptions(user_id)
  WHERE status IN ('ACTIVE', 'PAST_DUE', 'PAUSED');
-- 사용자당 active subscription 1개 강제 (LS 도 1 subscription per user/variant)
```

```sql
-- prisma/migrations/billing/002_billing_events.sql
CREATE TABLE public.billing_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL DEFAULT 'lemonsqueezy',
  provider_event_id   text NOT NULL,                   -- LS event id (idempotency key)
  event_name          text NOT NULL,                   -- subscription_created 등
  payload             jsonb NOT NULL,                  -- raw webhook body
  signature_ok        boolean NOT NULL,                -- HMAC 검증 결과
  processed_at        timestamptz,                     -- DB state 반영 완료 시각, NULL = failed
  error_message       text,                            -- processed_at IS NULL 일 때 사유
  received_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)                 -- 중복 webhook idempotent
);
CREATE INDEX idx_billing_events_received ON billing_events(received_at DESC);
CREATE INDEX idx_billing_events_unprocessed ON billing_events(received_at)
  WHERE processed_at IS NULL;
```

**Prisma schema 추가**: 위 두 테이블 model 정의 추가.

**기존 `payment_transactions` 모델 처분**: 본 phase 무수정. row count 측정 후 Phase 2 에서 결정 (옵션 A: 컬럼 확장 / 옵션 B: 신규 `billing_transactions` 테이블).

**PostgREST schema reload**: migration 후 `NOTIFY pgrst, 'reload schema'` + `docker restart supabase-rest-dev` 필수.

### L1 — Backend Routes

```
src/api/routes/billing/
├── index.ts          — plugin 등록
├── checkout.ts       — POST /api/v1/billing/checkout (checkout URL 발급)
├── webhook.ts        — POST /api/v1/billing/webhook (LS → BE, signature 검증)
├── portal.ts         — GET /api/v1/billing/portal (customer portal URL)
└── subscriptions.ts  — GET /api/v1/billing/subscriptions/me (내 구독 상태)
```

| Method | Path | Auth | 기능 |
|--------|------|------|------|
| POST | `/api/v1/billing/checkout` | user | body: `{ variantId? }`. LS `POST /v1/checkouts` 호출, `checkout_data.email` + `custom_price` (optional) + `custom_data.user_id` 포함. 응답의 `data.attributes.url` 반환. |
| POST | `/api/v1/billing/webhook` | public (signature) | LS event 수신. signature 검증 → `billing_events` INSERT (conflict no-op) → event_name 분기 처리 → 200. |
| GET | `/api/v1/billing/portal` | user | 현재 user 의 LS customer_id 로 portal URL 발급 (LS `GET /v1/customers/{id}` 응답의 `urls.customer_portal`). 구독 없으면 404. |
| GET | `/api/v1/billing/subscriptions/me` | user | 내 `billing_subscriptions` row + `user_subscriptions.tier` 조합 반환. |

**기존 admin route 치환**: `GET /api/v1/admin/billing/transactions` 은 Phase 2 (Stripe scaffold legacy 와 함께).

### L2 — Types

```typescript
// src/modules/billing/types.ts
export type BillingSubscriptionStatus =
  | 'PENDING' | 'ACTIVE' | 'PAST_DUE'
  | 'CANCELLED' | 'EXPIRED' | 'PAUSED';

export interface LemonSqueezyWebhookEvent<T = unknown> {
  meta: { event_name: string; custom_data?: { user_id?: string }; test_mode: boolean };
  data: { id: string; type: string; attributes: T };
}

export interface PlanCatalogEntry {
  variantId: string;       // LS variant id
  planCode: 'pro_monthly'; // MVP scope
  tier: 'pro';
  cardLimit: 1000;
  mandalaLimit: 20;
}
```

### L3 — Service / Module

```
src/modules/billing/
├── lemonsqueezy-client.ts   — LS API thin wrapper (Bearer auth + fetch)
├── webhook-verifier.ts      — HMAC-SHA256 signature 검증
├── webhook-handler.ts       — event_name → DB state transition
├── subscription-service.ts  — billing_subscriptions + user_subscriptions 동기화
├── plan-catalog.ts          — variantId ↔ planCode ↔ tier static map
├── config.ts                — zod env schema
└── types.ts
```

**lemonsqueezy-client.ts 핵심**:
```typescript
const BASE_URL = 'https://api.lemonsqueezy.com/v1';
function headers() {
  return {
    'Authorization': `Bearer ${config.LEMONSQUEEZY_API_KEY}`,
    'Accept': 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  };
}

async function createCheckout(input: { storeId: string; variantId: string; email: string; userId: string }) {
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: { email: input.email, custom: { user_id: input.userId } },
      },
      relationships: {
        store: { data: { type: 'stores', id: input.storeId } },
        variant: { data: { type: 'variants', id: input.variantId } },
      },
    },
  };
  const res = await fetch(`${BASE_URL}/checkouts`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new LemonSqueezyApiError(await res.text(), res.status);
  return res.json();
}
```

**webhook-verifier.ts 핵심** (LS docs 기준 알려진 패턴):
```typescript
import crypto from 'node:crypto';
export function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // timing-safe compare
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signatureHeader));
}
```

**webhook-handler.ts event 분기**:
| event_name | DB transition |
|------------|---------------|
| `subscription_created` | `billing_subscriptions` INSERT (status=ACTIVE) + `user_subscriptions.tier` = catalog.tier |
| `subscription_updated` | row UPDATE (status / current_period_end / cancel_at_period_end) |
| `subscription_cancelled` | status=CANCELLED, cancel_at_period_end=true, cancelled_at=now(). tier 유지 (period_end 까지) |
| `subscription_resumed` | status=ACTIVE, cancel_at_period_end=false, cancelled_at=null |
| `subscription_expired` | status=EXPIRED, tier='free' 강등 |
| `subscription_paused` | status=PAUSED |
| `subscription_unpaused` | status=ACTIVE |
| `subscription_payment_success` | current_period_end 갱신 |
| `subscription_payment_failed` | status=PAST_DUE (tier 유지, LS dunning 자동) |
| `order_created` | (Phase 2 lifetime 대응) MVP 에서는 log only |

### L4-L6 — Frontend

```
frontend/src/features/billing/
├── model/
│   ├── useCheckoutUrl.ts        — POST /billing/checkout → location.href redirect
│   ├── useSubscription.ts       — GET /billing/subscriptions/me
│   └── usePortalUrl.ts          — GET /billing/portal
└── ui/
    ├── PlanSelector.tsx         — pro_monthly 카드 1장 (MVP)
    ├── SubscribeButton.tsx      — 클릭 시 checkout URL redirect
    └── SubscriptionStatusCard.tsx — ACTIVE / PAST_DUE / CANCELLED 표시 + Portal 진입 버튼
```

**orchestrator**: `MyPage` 가 `useSubscription` 으로 상태 조회 → 없으면 `PlanSelector` 표시, 있으면 `SubscriptionStatusCard` 표시. 기존 free→pro lock gate (cardLimit 초과 시) 도 `PlanSelector` 진입점으로 연결.

**redirect flow**:
1. user → `SubscribeButton` 클릭 → BE `POST /billing/checkout` → checkout URL 응답
2. FE `window.location.href = checkoutUrl` → LS hosted checkout
3. user 결제 → LS success_url (= `${origin}/billing/success`) 로 redirect
4. `/billing/success` 페이지 = 단순 "구독 처리 중..." 표시 후 `useSubscription` polling (1s interval, 10s timeout) → ACTIVE 되면 MyPage navigate
5. webhook 은 LS → BE 비동기로 별도 도착 (success_url 도착 시점에 webhook 미처리 가능 → polling 필요)

---

## §4 Environment Variables

**credentials.md L1/L4/L6 업데이트 동반** (CLAUDE.md `.env` 불변 Hard Rule, 사용자가 CLI 직접 주입).

```
# .env (local dev) — 사용자 CLI inline 주입
LEMONSQUEEZY_API_KEY=test_...                       # LS Settings → API (Secret)
LEMONSQUEEZY_WEBHOOK_SECRET=...                     # Webhooks 등록 시 발급 (Secret)
LEMONSQUEEZY_STORE_ID=369843                        # Insighta store (Non-secret, GH Variable)
LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY=1648440         # pro_monthly ($9.99 USD/mo, Variable)
LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY=1648443          # pro_yearly (Variable)

# frontend/.env (Vite client bundle)
# 현재 단계에서는 FE 에 LS 키 불필요 (checkout URL 은 BE 가 발급)
# 추후 overlay JS 도입 시 VITE_LEMONSQUEEZY_STORE_URL 등 검토
```

**GitHub Secrets/Variables (prod, CP392 rule 적용)**:
- `secrets.LEMONSQUEEZY_API_KEY` — Sensitive (Secret).
- `secrets.LEMONSQUEEZY_WEBHOOK_SECRET` — Sensitive (Secret).
- `vars.LEMONSQUEEZY_STORE_ID` — `369843` (Variable, non-secret).
- `vars.LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY` — `1648440` (Variable).
- `vars.LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY` — `1648443` (Variable).

**deploy.yml**: 5종 env idempotent `grep -q / sed -i / echo >>` 패턴 추가 — `/opt/tubearchive/.env` 에 주입. Phase 1 commit 에 포함.

**Non-secret config 검증** (CLAUDE.md Rule):
- `LEMONSQUEEZY_API_KEY` → 명백한 secret ✓
- `LEMONSQUEEZY_WEBHOOK_SECRET` → 명백한 secret ✓
- `LEMONSQUEEZY_STORE_ID` → store id 자체는 LS dashboard URL 에 노출되므로 non-secret 이지만, prod/test 분리 위해 Secret 등록 유지 (config drift 회피).

**SECURITY 검증 (CP454/CP455 family)**: 본 doc 작성 단계에서 실제 키 값 0 노출. 키 수령 시 `awk -F=` / `grep -iE` / 직접 print 절대 금지 — `grep -c '^LEMONSQUEEZY_'` (count) 또는 mask 패턴만 사용.

---

## §5 Test Plan

### 5.1 Unit tests (Jest, `tests/smoke/billing/`)

1. `webhook-verifier.verifySignature` — 정상 HMAC PASS, 변조 FAIL, empty body FAIL
2. `webhook-handler.handleEvent` — 각 event_name 별 DB state transition (mock prisma)
3. `subscription-service.upsertSubscription` — 신규 INSERT vs 기존 UPDATE 분기
4. `plan-catalog.resolveVariant` — 알려진 variant_id → tier, 미등록 variant_id → null

### 5.2 Integration tests

1. `POST /billing/webhook` — 정상 signature 200 + DB row, 변조 401 + DB 무변화
2. `POST /billing/webhook` 중복 event id → 멱등 (DB row 1개만)
3. `POST /billing/checkout` → LS mock 200 시 URL 반환, 401 시 error 전파

### 5.3 Manual E2E (LS test store)

**사전조건**: `.env` 에 test 키 3종 배치 완료, local DB migration 적용, dev server 기동, ngrok / cloudflare tunnel 로 BE 포트 3000 외부 노출 후 LS dashboard Webhooks → `{tunnel}/api/v1/billing/webhook` 등록.

1. login → `/mypage` → `PlanSelector` → "Pro 구독" 클릭
2. LS hosted checkout 페이지 redirect → email 자동 입력 (BE 가 전달) → 테스트 카드 `4242 4242 4242 4242` + 미래 만료일 + 임의 CVC
3. 결제 완료 → success_url 도착 → `/billing/success` 가 polling
4. webhook 도착 (LS → ngrok → BE) → signature 검증 PASS → `billing_events` row + `billing_subscriptions` row INSERT
5. polling 이 ACTIVE 감지 → MyPage navigate → `SubscriptionStatusCard` 표시 + next_billing 표시
6. LS dashboard → Subscriptions tab 에서 동일 row 시각 확인 (양쪽 일치)
7. MyPage → "결제 관리" → portal URL redirect → LS portal 에서 cancel
8. webhook `subscription_cancelled` 수신 → DB `status='CANCELLED'`, `cancel_at_period_end=true`
9. `user_subscriptions.tier` = `'pro'` 유지 (current_period_end 까지)
10. LS dashboard 에서 test subscription 강제 expire 시뮬 → webhook `subscription_expired` → tier='free' 강등 확인

**실측 기록 의무**: 각 step 의 wall-clock + DB row diff + LS dashboard 스크린샷 또는 cell 캡쳐. 이론치 금지.

### 5.4 api-url-contract

`api-url-contract.test.ts` 가 신규 4 endpoint 자동 검출. FE `api-client.ts` 에 `billing.checkout()`, `billing.portal()`, `billing.subscription()` 메서드 추가.

---

## §6 Don't Touch — 보호 목록

1. **`src/api/routes/subscriptions.ts`** — user-to-user follow 전용. billing 과 무관. 신규 route 는 `/api/v1/billing/*` 로 분리.
2. **`prisma/schema.prisma` 기존 `payment_transactions`** — Phase 1 무수정. row count 측정 후 Phase 2 결정.
3. **`prisma/schema.prisma` 기존 `user_subscriptions`** — `tier` 컬럼 UPDATE 만, 스키마 변경 0.
4. **Stripe scaffold** (`src/api/routes/admin/payments.ts`) — 삭제 금지. `-legacy/` 이동 + `@deprecated` JSDoc.
5. **`frontend/src/shared/config/subscription-tiers.ts`** — limit/tier 상수 유지. plan_code → tier 매핑은 BE plan-catalog 에서.
6. **`.env`, `.env.local`, `.env.production`** — CLAUDE.md CP358 Hard Rule. AI 0 touch, 사용자 CLI inline 만.
7. **`docs/design/recurring-billing-2026-04-22.md`** — 삭제 금지, 헤더에 SUPERSEDED 마커만 추가.

---

## §7 Rollback Strategy

### 7.1 Runtime rollback (배포 후 문제 발생)

- **전체 off**: `LEMONSQUEEZY_API_KEY` unset → 모든 `/billing/*` route 503 + FE `PlanSelector` 숨김 (env 부재 시 fallback).
- **Webhook 만 정지**: `LEMONSQUEEZY_WEBHOOK_SECRET` 회전 → LS dashboard 에서 webhook URL temporarily disable → BE 재배포로 신규 secret 반영.
- **Frontend 만 정지**: PlanSelector 컴포넌트 conditional render flag (`VITE_BILLING_ENABLED`) 추가하여 off.

### 7.2 DB rollback

각 raw SQL migration 에 대응하는 DOWN 파일 동봉:

```sql
-- prisma/migrations/billing/001_billing_subscriptions.down.sql
DROP TABLE public.billing_subscriptions;
DROP TYPE billing_subscription_status;

-- prisma/migrations/billing/002_billing_events.down.sql
DROP TABLE public.billing_events;
```

`user_subscriptions.tier` rollback: 영향 받은 user row 의 tier 를 'free' 로 reset. 영향 user list 는 `billing_events.payload->>'data'->>'attributes'->>'user_email'` 또는 `billing_subscriptions.user_id` 에서 추출.

### 7.3 결제 장애 시 운영 절차

- Webhook secret 노출 의심: LS dashboard → 신규 secret 발급 → GitHub Secret 갱신 → prod redeploy → 기존 secret 만료.
- LS 장애 (API 5xx 응답): checkout URL 발급 실패 → FE 에 "잠시 후 다시 시도" 토스트 + sentry alert. 기존 ACTIVE 구독은 영향 없음 (LS 가 다음 주기에 자체 retry).
- 환불 요청: admin 이 LS dashboard 에서 수동 refund → LS 가 webhook `order_refunded` 송신 → BE 가 `billing_events` 만 기록 (Phase 1 에서는 tier 변경 없음, admin 수동 결정).

---

## §8 Phase Plan

### Phase 0 — 이 doc 작성 + 사용자 review (현재 단계)
- ✓ design doc 초안
- → 사용자 review + ADR 확정 + Open Q 답변 → Phase 1 진입

### Phase 1 — DB + 라우트 + 모듈 (1-2d)
| # | 작업 | 종속 |
|---|------|------|
| 1.1 | L0 migration 2개 (billing_subscriptions + billing_events) + Prisma schema + local + prod 검증 | — |
| 1.2 | L3 modules (client + verifier + handler + service + catalog + config) + unit tests | 1.1 |
| 1.3 | L1 routes (checkout + webhook + portal + subscriptions) + integration tests | 1.2 |
| 1.4 | Stripe scaffold `-legacy/` 이동 + `@deprecated` | 1.3 |

### Phase 2 — FE + E2E (1d)
| # | 작업 | 종속 |
|---|------|------|
| 2.1 | L4-L6 FE (3 hooks + 3 components) + `/billing/success` page | 1.3 |
| 2.2 | ngrok tunnel + LS test store webhook 등록 | 1.3 |
| 2.3 | Manual E2E (구독 → cancel → portal → expire) + 실측 기록 | 2.1, 2.2 |
| 2.4 | `/verify` PASS + PR | 2.3 |

### Phase 3 — credentials.md + Secret + prod 배포 (0.5d)
| # | 작업 | 종속 |
|---|------|------|
| 3.1 | credentials.md L1/L4/L6 row 3개 추가 | 2.4 |
| 3.2 | `gh secret set LEMONSQUEEZY_*` (prod live 키, 사용자 직접) | 3.1 |
| 3.3 | deploy.yml `grep -q / sed -i / echo >>` 라인 3줄 추가 PR | 3.1 |
| 3.4 | prod store + webhook URL prod 등록 (사용자 직접) | 3.3 |
| 3.5 | prod canary 1건 결제 + 즉시 refund | 3.4 |

**Phase 1+2+3 합계**: ~3-4d. Phase 1 → 2 → 3 sequential. 범위 이탈 시 즉시 stop + design iter (CP415 patch-on-patch 방지).

### Phase 4 — 이후 (별도 세션)
- pro_annual 추가 (variant 1개 추가, plan-catalog row 추가)
- lifetime = LS one-time order (변형 catalog + `order_created` webhook 처리)
- 환불 셀프서비스 UI
- Admin transactions 대시보드 (LS API `GET /v1/orders` 기반)
- 부가세 영수증 안내 UI

---

## §9 Open Questions (사용자 답변 / default 자동 적용)

**Q1** ✅ **RESOLVED 2026-05-13**: Plan 카탈로그 = pro_monthly only (MVP). lifetime + pro_annual 보류 → Phase 2. (ADR-10 확정)

**Q2** ✅ **RESOLVED 2026-05-13**: pro_monthly 금액 = **$9.99 USD/month**. LS Merchant of Record 가 한국 부가세 자동 정산. (ADR-10 확정)

**Q3** ✅ **RESOLVED 2026-05-13**: Checkout 방식 = Hosted URL redirect. (ADR-2 확정)

**Q4** ⏸ **DEFERRED**: cancel 시 즉시 종료 vs current_period_end 까지 pro 유지. **임시 default**: period_end 까지 유지 (업계 default, ADR-12). Phase 2 entry 직전 사용자 재확인.

**Q5** ⏸ **DEFERRED**: 환불 셀프서비스 UI 포함 여부. **임시 default**: Phase 1 미포함 (admin 수동 LS dashboard refund). Phase 2 에 별도 spec.

**Q6** ⏸ **DEFERRED**: webhook 외부 노출 도구 (ngrok / cloudflare tunnel). **임시 default**: cloudflare tunnel. Phase 2 E2E 단계 직전 사용자 재확인.

**Q7** (신규, Phase 3 시): webhook URL prod 경로 — `https://api.insighta.io/api/v1/billing/webhook` 또는 별도 subdomain. **Default**: 기존 api 도메인 그대로 + 별도 rate-limit bucket.

**Q8** (신규, Phase 2 시): success_url / cancel_url FE 경로 — `/billing/success`, `/billing/cancel`. **Default**: 그대로 (Phase 2 에서 page 컴포넌트 신설).

---

## §10 Risk Register

| # | 위험 | 확률 | 영향 | 완화 |
|---|------|------|------|------|
| R1 | LS webhook signature 알고리즘 docs 미확인 (HMAC-SHA256 가정) | M | H | 키 수령 직후 LS API 응답 / 실제 webhook 로 검증, doc v2 update |
| R2 | LS test mode 의 webhook 발송 동작 차이 (실제 결제 vs simulated) | M | M | LS dashboard 에서 "Send test webhook" 기능으로 사전 검증 |
| R3 | Fastify raw body parser 충돌 (전역 JSON parser vs webhook raw) | M | M | webhook route 한정 `addContentTypeParser` + `parseAs: 'buffer'` |
| R4 | success_url 도착 시점에 webhook 미처리 → FE polling 무한 | L | M | polling timeout 10s + UI "잠시 후 새로고침" fallback |
| R5 | LS API 5xx → checkout URL 발급 실패 | L | M | FE 토스트 + retry 버튼 + sentry alert |
| R6 | 환율 변동 (LS USD vs 사용자 한국 카드 환전) | L | L | LS Merchant of Record 가 정산, Insighta 무관 |
| R7 | webhook idempotency 누락 시 중복 INSERT | L | H | UNIQUE constraint (provider, provider_event_id) + INSERT ON CONFLICT DO NOTHING |
| R8 | prod canary 결제 후 refund 까지 LS dashboard timing | L | L | 사용자 즉시 refund, $9.99 손실 acceptable |
| R9 | "추측 패턴 6+ 재발" (CP456 IT) — LS docs 미확인 부분 hypothesis-first 응답 | H | H | doc 의 `(LS docs 미확인)` 마크 항목은 키 수령 시 실측 검증 후 v2 update |
| R10 | 기존 `payment_transactions` 모델 처분 — 무수정 정책이 Phase 2 까지 지연 | L | L | row count 0 확인 시 Phase 2 컬럼 확장 단순, non-zero 시 별도 PR |

---

## §11 Decision Checkpoint

**사용자 확정 대기**:
1. §9 Q1~Q8 답변 (또는 "default 진행")
2. §2 ADR 12개 중 이의 있는 항목
3. §8 Phase 1+2+3 공수 추정 수용 가능?
4. §3 L0 스키마 (특히 `billing_subscriptions` 컬럼 구성) 에 빠진 필드?

승인 시 Phase 1 진입 — 첫 step = L0 migration SQL 작성 + Prisma schema model 추가.

---

## §12 References

- Lemon Squeezy — Test Mode: https://docs.lemonsqueezy.com/help/getting-started/test-mode (WebFetch 403, 키 수령 시 재확인)
- Lemon Squeezy — API Reference (general): https://docs.lemonsqueezy.com/api
- Lemon Squeezy — Webhooks: https://docs.lemonsqueezy.com/help/webhooks
- Lemon Squeezy — Checkouts API: https://docs.lemonsqueezy.com/api/checkouts
- Lemon Squeezy — Subscriptions: https://docs.lemonsqueezy.com/api/subscriptions
- 기존 토스+PayPal 설계 (superseded): `docs/design/recurring-billing-2026-04-22.md`
- CLAUDE.md — DB Work Order, `.env` 불변, Cross-Layer Propagation, prisma db push silent fail, SECURITY env mask
- credentials.md — L1/L4/L6 구조
- CP455/CP456 carryover — 추측-금지 (CP456 IT measurement-first), SECURITY env-value mask, peer-dep static import

---

## §13 Change Log

| Version | Date | Change |
|---------|------|--------|
| v1 | 2026-05-13 | 초안. CP456 IT (measurement-first) 준수 — LS docs WebFetch 403 표기, 가설 항목 마크. ADR 12개 + L0-L6 layer + Open Q 8개 + Risk 10개. Toss+PayPal 설계 supersede. |
| v1.1 | 2026-05-13 | 사용자 답변 반영: Q1 (pro_monthly only) + Q2 ($9.99 USD) + Q3 (Hosted URL redirect) **확정**. Q4-Q6 **deferred** with 임시 default. ADR-10 에 $9.99 USD 명시. |
| v1.2 | 2026-05-13 | Phase 1.1 실측 동기화: status enum 대신 text + CHECK (codebase Prisma enum 0건 convention). updated_at trigger 추가. §4 에 `LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY` env 추가. |
| v1.3 | 2026-05-13 | 사용자 LS dashboard setup 완료: Store ID `369843` (`insightaone.lemonsqueezy.com`) + Product `1050991` + Variant `1648440` (monthly) + `1648443` (yearly). ADR-10 → pro_monthly + pro_yearly **양쪽 활성** (MVP 확장). Webhook URL = `https://insighta.one/api/v1/billing/webhook` (LS dashboard 에 사용자 수정 완료). credentials.md L6 테이블 + deploy.yml 5종 env 주입 패턴 동기화. CP392 Hard Rule 준수 — API_KEY/WEBHOOK_SECRET=Secret, STORE_ID/VARIANT_*=Variable. |
