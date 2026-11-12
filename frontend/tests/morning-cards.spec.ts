import { test, expect, type Page, type Route } from '@playwright/test';

// Mobile morning cards (PRD #1788) at a phone viewport. All API routes are
// mocked and the session is faked in localStorage: no login, no external network.

test.use({ viewport: { width: 390, height: 844 } });

const SWIPE_DISTANCE_PX = 160;
const SWIPE_STEPS = 8;
const FAR_FUTURE_SECONDS = 4_102_444_800; // year 2100

interface MockCard {
  video_id: string;
  title: string;
  channel_name: string;
  published_at: string;
  thumbnail_url: string | null;
  reason: string;
}

const CARDS: MockCard[] = [
  {
    video_id: 'aaaaaaaaaaa',
    title: 'First card <script>window.__xss = 1</script>',
    channel_name: 'Channel One',
    published_at: '2026-03-05T00:00:00.000Z',
    thumbnail_url: null,
    reason: 'matches the domain',
  },
  {
    video_id: 'bbbbbbbbbbb',
    title: 'Second card',
    channel_name: 'Channel Two',
    published_at: '2026-04-06T00:00:00.000Z',
    thumbnail_url: null,
    reason: 'recent upload',
  },
  {
    video_id: 'ccccccccccc',
    title: 'Third card',
    channel_name: 'Channel Three',
    published_at: '2026-05-07T00:00:00.000Z',
    thumbnail_url: null,
    reason: 'recent upload',
  },
];

// The API origin differs from the page origin, so every mocked answer (and the
// CORS preflight) must carry explicit CORS headers.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
};

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS_HEADERS,
    body: JSON.stringify({ data }),
  });
}

async function fakeSession(page: Page): Promise<void> {
  await page.addInitScript((expiresAt) => {
    const session = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'tester@example.test',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
      },
    };
    // The storage key depends on the Supabase host (sb-<host>-auth-token), which is
    // unknown here. Answer any such key with the fake session instead of guessing.
    const authKey = /^sb-.+-auth-token$/;
    const realGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string): string | null {
      if (this === window.localStorage && authKey.test(key)) return JSON.stringify(session);
      return realGetItem.call(this, key);
    };
  }, FAR_FUTURE_SECONDS);
}

async function mockApi(
  page: Page,
  cardsFor: (domain: string) => MockCard[]
): Promise<{ judgments: Record<string, unknown>[] }> {
  const captured: { judgments: Record<string, unknown>[] } = { judgments: [] };
  await page.route('**/api/v1/morning-cards/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/status')) return json(route, { enabled: true });
    if (url.pathname.endsWith('/judgments') && route.request().method() === 'POST') {
      captured.judgments.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { saved: true }, 201);
    }
    const domain = url.searchParams.get('domain') ?? '';
    const cards = cardsFor(domain);
    return json(route, { domain, cards, shortage: cards.length === 0 });
  });
  return captured;
}

async function swipe(page: Page, direction: 'right' | 'left'): Promise<void> {
  const area = page.getByTestId('morning-card-swipe-area');
  const box = await area.boundingBox();
  if (!box) throw new Error('swipe area not visible');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const delta = direction === 'right' ? SWIPE_DISTANCE_PX : -SWIPE_DISTANCE_PX;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + delta, startY, { steps: SWIPE_STEPS });
  await page.mouse.up();
}

test.describe('mobile morning cards', () => {
  test('card and upload date are visible; each swipe advances and sends one judgment', async ({
    page,
  }) => {
    await fakeSession(page);
    const captured = await mockApi(page, () => CARDS);

    await page.goto('/morning-cards');

    const card = page.getByTestId('morning-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('morning-card-date')).toBeVisible();
    // Title with <script> is shown as literal text, not executed.
    await expect(card).toContainText('<script>window.__xss = 1</script>');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBe(
      undefined
    );
    await page.screenshot({ path: 'test-results/morning-cards-first.png' });

    await swipe(page, 'right');
    await expect(card).toContainText('Second card');
    await expect.poll(() => captured.judgments.length).toBe(1);

    await swipe(page, 'left');
    await expect(card).toContainText('Third card');
    await expect.poll(() => captured.judgments.length).toBe(2);
    await page.screenshot({ path: 'test-results/morning-cards-third.png' });

    expect(captured.judgments).toEqual([
      { video_id: 'aaaaaaaaaaa', domain: 'work_practice', verdict: 'useful', shown_position: 0 },
      { video_id: 'bbbbbbbbbbb', domain: 'work_practice', verdict: 'skip', shown_position: 1 },
    ]);
  });

  test('empty domain shows the honest message and zero cards', async ({ page }) => {
    await fakeSession(page);
    await mockApi(page, () => []);

    await page.goto('/morning-cards');

    await expect(page.getByTestId('morning-cards-empty')).toContainText(
      '올해 올라온 영상이 적습니다'
    );
    await expect(page.getByTestId('morning-card')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/morning-cards-empty.png' });
  });
});
