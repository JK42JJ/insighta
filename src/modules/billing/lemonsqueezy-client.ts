/**
 * Lemon Squeezy API client (thin fetch wrapper).
 *
 * Auth: `Authorization: Bearer ${API_KEY}`.
 * Content-Type / Accept: `application/vnd.api+json` (JSON:API spec).
 * Base: https://api.lemonsqueezy.com/v1
 *
 * Only methods we actually call land here. Add lazily; do not preemptively
 * scaffold the full API surface (YAGNI, ADR-3).
 */

import { logger } from '@/utils/logger';
import { billingConfig } from './config';

const BASE_URL = 'https://api.lemonsqueezy.com/v1';
const CONTENT_TYPE_JSONAPI = 'application/vnd.api+json';
const DEFAULT_TIMEOUT_MS = 10_000;

export class LemonSqueezyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = 'LemonSqueezyApiError';
  }
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${billingConfig.apiKey}`,
    Accept: CONTENT_TYPE_JSONAPI,
    'Content-Type': CONTENT_TYPE_JSONAPI,
  };
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!billingConfig.enabled) {
    throw new LemonSqueezyApiError('billing disabled (config missing)', 503, '');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: authHeaders(),
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn('LemonSqueezy API non-2xx', {
        path,
        status: res.status,
        body_excerpt: text.slice(0, 200),
      });
      throw new LemonSqueezyApiError(`LS ${method} ${path} ${res.status}`, res.status, text);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

export interface CreateCheckoutInput {
  variantId: string;
  email: string;
  userId: string;
  /** Optional override of LS-configured URLs. Hosted checkout default uses store config. */
  successUrl?: string;
  /**
   * Render the LS overlay in dark theme. Caller passes the user's current site
   * theme (Tailwind `.dark` class on `<html>`) so the overlay matches per-user
   * preference rather than a store-wide LS setting.
   */
  dark?: boolean;
  /**
   * Locale for the LS hosted checkout page (e.g., 'ko', 'en'). Maps to
   * `checkout_options.locale`. Pass the user's current `i18n.language` so the
   * checkout matches the rest of the app.
   */
  locale?: string;
}

export interface CreateCheckoutResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      url: string;
      expires_at: string | null;
    };
  };
}

/**
 * POST /v1/checkouts — create hosted checkout URL.
 * Stores Insighta user_id in `custom_data` so the webhook can attribute
 * back. LS forwards `custom_data` on every related event (subscription
 * created/updated/cancelled).
 */
export async function createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResponse> {
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: input.email,
          custom: { user_id: input.userId },
        },
        // CP456: dynamic dark/light + locale based on caller (Insighta user's
        // current theme + i18n.language). LS overlay iframe is on
        // `lemonsqueezy.com` domain so our CSS cannot reach it — these
        // checkout_options entries are the only knobs.
        checkout_options: {
          dark: input.dark ?? false,
          ...(input.locale ? { locale: input.locale } : {}),
        },
        ...(input.successUrl ? { product_options: { redirect_url: input.successUrl } } : {}),
      },
      relationships: {
        store: { data: { type: 'stores', id: billingConfig.storeId } },
        variant: { data: { type: 'variants', id: input.variantId } },
      },
    },
  };
  return request<CreateCheckoutResponse>('POST', '/checkouts', body);
}

export interface CustomerResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      urls?: {
        customer_portal?: string;
      };
    };
  };
}

/**
 * GET /v1/customers/{id} — fetch customer (used to get the portal URL).
 * `attributes.urls.customer_portal` is a signed URL valid for ~24h.
 */
export async function getCustomer(customerId: string): Promise<CustomerResponse> {
  return request<CustomerResponse>('GET', `/customers/${encodeURIComponent(customerId)}`);
}

export interface ActiveSubscriptionSummary {
  subscriptionId: string;
  status: string;
  variantId: string;
  customerPortalUrl: string | null;
}

interface SubscriptionsListResponse {
  data: Array<{
    id: string;
    attributes: {
      status: string;
      variant_id: number;
      user_email: string;
      urls?: { customer_portal?: string };
    };
  }>;
}

/**
 * GET /v1/subscriptions?filter[user_email]=...
 *
 * Used by the checkout route as a preflight to short-circuit when the user
 * already has an active LS subscription. webhook may not have landed locally
 * (dev environment without a tunnel), so we treat LS as source of truth here.
 *
 * LS treats `active`, `on_trial`, `past_due`, `paused`, and even `cancelled`
 * (when ends_at is in the future) as occupying the subscription slot. We only
 * block on the actively-billing statuses; expired / fully cancelled allow a
 * fresh subscription.
 */
const ACTIVE_LS_STATUSES = new Set(['active', 'on_trial', 'past_due', 'paused']);

export async function findActiveSubscriptionByEmail(
  email: string
): Promise<ActiveSubscriptionSummary | null> {
  const params = new URLSearchParams();
  params.set('filter[user_email]', email);
  const res = await request<SubscriptionsListResponse>(
    'GET',
    `/subscriptions?${params.toString()}`
  );
  for (const row of res.data) {
    if (ACTIVE_LS_STATUSES.has(row.attributes.status)) {
      return {
        subscriptionId: row.id,
        status: row.attributes.status,
        variantId: String(row.attributes.variant_id),
        customerPortalUrl: row.attributes.urls?.customer_portal ?? null,
      };
    }
  }
  return null;
}
