import { test, expect } from '@playwright/test';
import { injectAxe, getViolations } from 'axe-playwright';

test.describe('Accessibility - Landing Page', () => {
  test('should have no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await injectAxe(page);

    const violations = await getViolations(page, undefined, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });

    if (violations.length > 0) {
      const summary = violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({ html: n.html, target: n.target, message: n.failureSummary })),
        help: v.helpUrl,
      }));
      console.log('Accessibility violations:\n', JSON.stringify(summary, null, 2));
    }

    expect(violations).toEqual([]);
  });

  test('should have a skip-nav link pointing to #main-content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Wait for React to hydrate — skip-nav is in App.tsx root
    await page.waitForSelector('#main-content', { timeout: 10_000 });

    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();

    const text = await skipLink.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
