# Web App Testing Skill

Playwright 기반 E2E 테스트 패턴 및 웹 애플리케이션 테스트 가이드.

## 사용법

```bash
/webapp-testing [target] [options]
```

## Playwright 기본 설정

### 설치

```bash
npm init playwright@latest
# 또는
npx playwright install
```

### 설정 파일

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['junit', { outputFile: 'test-results/junit.xml' }]
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

## 테스트 구조

### 디렉토리 레이아웃

```
tests/
├── e2e/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   └── logout.spec.ts
│   ├── playlist/
│   │   ├── sync.spec.ts
│   │   └── manage.spec.ts
│   └── fixtures/
│       └── auth.fixture.ts
├── page-objects/
│   ├── LoginPage.ts
│   ├── PlaylistPage.ts
│   └── BasePage.ts
└── utils/
    ├── test-data.ts
    └── helpers.ts
```

## Page Object Model

### Base Page

```typescript
// tests/page-objects/BasePage.ts
import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(path: string = '/') {
    await this.page.goto(path);
  }

  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }
}
```

### Login Page

```typescript
// tests/page-objects/LoginPage.ts
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Sign in' });
    this.errorMessage = page.getByRole('alert');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(message: string) {
    await expect(this.errorMessage).toContainText(message);
  }
}
```

## 테스트 패턴

### 기본 테스트

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/LoginPage';

test.describe('Authentication', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.navigate('/login');
  });

  test('should login with valid credentials', async ({ page }) => {
    await loginPage.login('user@example.com', 'password123');
    await expect(page).toHaveURL('/dashboard');
  });

  test('should show error with invalid credentials', async () => {
    await loginPage.login('invalid@example.com', 'wrong');
    await loginPage.expectError('Invalid credentials');
  });
});
```

### Fixtures 활용

```typescript
// tests/e2e/fixtures/auth.fixture.ts
import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../../page-objects/LoginPage';

type AuthFixtures = {
  loginPage: LoginPage;
  authenticatedPage: void;
};

export const test = base.extend<AuthFixtures>({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate('/login');
    await use(loginPage);
  },

  authenticatedPage: async ({ page }, use) => {
    // Setup: Login
    await page.goto('/login');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/dashboard');

    await use();

    // Teardown: Logout
    await page.getByRole('button', { name: 'Logout' }).click();
  },
});

export { expect };
```

### API Mocking

```typescript
import { test, expect } from '@playwright/test';

test('should display playlists from API', async ({ page }) => {
  // Mock API response
  await page.route('**/api/playlists', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        playlists: [
          { id: '1', title: 'My Playlist', videoCount: 10 },
          { id: '2', title: 'Favorites', videoCount: 25 },
        ]
      }),
    });
  });

  await page.goto('/playlists');

  await expect(page.getByText('My Playlist')).toBeVisible();
  await expect(page.getByText('Favorites')).toBeVisible();
});
```

### Visual Testing

```typescript
import { test, expect } from '@playwright/test';

test('should match visual snapshot', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');

  // Full page screenshot
  await expect(page).toHaveScreenshot('dashboard.png', {
    fullPage: true,
    mask: [page.locator('.dynamic-content')], // Mask dynamic elements
  });

  // Component screenshot
  const header = page.locator('header');
  await expect(header).toHaveScreenshot('header.png');
});
```

### 접근성 테스트

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('should have no accessibility violations', async ({ page }) => {
    await page.goto('/');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('/');

    // Tab through interactive elements
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('role', 'button');

    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveAttribute('href');
  });
});
```

## 성능 테스트

```typescript
import { test, expect } from '@playwright/test';

test('should load within performance budget', async ({ page }) => {
  await page.goto('/');

  const performanceMetrics = await page.evaluate(() => {
    const timing = performance.timing;
    return {
      loadTime: timing.loadEventEnd - timing.navigationStart,
      domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
      firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime,
      firstContentfulPaint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
    };
  });

  expect(performanceMetrics.loadTime).toBeLessThan(3000);
  expect(performanceMetrics.firstContentfulPaint).toBeLessThan(1500);
});

test('should have good Core Web Vitals', async ({ page }) => {
  await page.goto('/');

  // Measure Largest Contentful Paint
  const lcp = await page.evaluate(() => {
    return new Promise((resolve) => {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        resolve(entries[entries.length - 1].startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
  });

  expect(lcp).toBeLessThan(2500); // Good LCP < 2.5s
});
```

## 테스트 데이터 관리

```typescript
// tests/utils/test-data.ts
export const testUsers = {
  valid: {
    email: 'test@example.com',
    password: 'Password123!',
  },
  admin: {
    email: 'admin@example.com',
    password: 'AdminPass123!',
  },
};

export const testPlaylists = {
  sample: {
    id: 'PLxxxxx',
    url: 'https://www.youtube.com/playlist?list=PLxxxxx',
    title: 'Test Playlist',
    videoCount: 10,
  },
};

// Factory pattern for dynamic data
export function createTestUser(overrides = {}) {
  return {
    email: `user-${Date.now()}@test.com`,
    password: 'TestPassword123!',
    ...overrides,
  };
}
```

## 명령어

```bash
# 모든 테스트 실행
npx playwright test

# 특정 브라우저
npx playwright test --project=chromium

# 특정 파일
npx playwright test tests/e2e/auth/login.spec.ts

# UI 모드 (디버깅)
npx playwright test --ui

# 헤드풀 모드
npx playwright test --headed

# 디버그 모드
npx playwright test --debug

# 리포트 열기
npx playwright show-report

# 스크린샷 업데이트
npx playwright test --update-snapshots
```

## CI/CD 통합

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Browsers
        run: npx playwright install --with-deps

      - name: Run Playwright tests
        run: npx playwright test

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Best Practices

### Do

- Page Object Model 사용
- 명시적 대기 (`waitFor*`) 사용
- 테스트 격리 유지
- 의미 있는 테스트 이름 사용
- API mocking으로 안정성 확보
- 접근성 테스트 포함

### Don't

- 하드코딩된 타임아웃 사용
- 테스트 간 상태 공유
- 셀렉터에 CSS 클래스만 의존
- 모든 것을 E2E로 테스트
- 불안정한 테스트 무시

## 참조

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model](https://playwright.dev/docs/pom)
- [Axe Accessibility Testing](https://www.deque.com/axe/)
