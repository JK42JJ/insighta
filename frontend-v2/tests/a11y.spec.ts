import { test, expect } from '@playwright/test';
import { injectAxe, getViolations } from 'axe-playwright';

test.describe('Accessibility - Landing Page', () => {
  test('should have no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Ensure dark mode theme is applied before scanning
    await page.waitForSelector('html.dark', { state: 'attached', timeout: 5000 });
    // Wait for landing page animations to settle (fade-in has 0.6s delay + 0.6s duration)
    await page.waitForTimeout(1500);
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

    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();

    const text = await skipLink.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
