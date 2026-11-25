import { existsSync, readFileSync } from 'node:fs';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BRIEF_MANIFEST } from '@/features/morning-feed/use-app-shell';
import { BrandLogo } from '@/shared/ui/brand-logo';

/* Logo handoff 2026-11-25 (assets/logo/README.md): symbol geometry, colours, word, install icons. */

const css = readFileSync('src/shared/ui/brand-logo/brand-logo.css', 'utf8');

describe('brand logo', () => {
  it('draws the handoff symbol and the lower-case word, named Insighta', () => {
    const { container } = render(<BrandLogo />);
    const r = container.querySelector('rect')!;
    expect(['x', 'y', 'width', 'height', 'rx'].map((a) => r.getAttribute(a))).toEqual([
      '12',
      '20',
      '11',
      '22',
      '5.5',
    ]);
    const c = container.querySelector('circle')!;
    expect(['cx', 'cy', 'r'].map((a) => c.getAttribute(a))).toEqual(['30', '12', '6.5']);
    expect(screen.getByLabelText('Insighta').textContent).toBe('insighta');
  });

  it('mineral blue dot and ink stroke, with the pair for dark grounds', () => {
    expect(css).toContain('--brand-dot: #4d68a8');
    expect(css).toContain('--brand-ink: #141a24');
    expect(css).toContain('--brand-dot-dark: #93a8d6');
    expect(css).toContain('--brand-ink-dark: #f5f3ee');
    render(<BrandLogo dark />);
    expect(screen.getByTestId('brand-logo').hasAttribute('data-dark')).toBe(true);
  });

  it('the installed app has its icons: every file of the manifest exists, one is maskable', () => {
    const m = JSON.parse(readFileSync('public' + BRIEF_MANIFEST, 'utf8')) as {
      icons: Array<{ src: string; purpose?: string }>;
    };
    for (const i of m.icons) expect([i.src, existsSync('public' + i.src)]).toEqual([i.src, true]);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    // work order B11: the same app from any screen, opened at the root, sign-in stays inside its scope
    expect(m).toMatchObject({
      name: 'Insighta',
      short_name: 'Insighta',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      background_color: '#F5F3EE',
      theme_color: '#F5F3EE',
    });
    const html = readFileSync('index.html', 'utf8');
    for (const f of ['/favicon.svg', '/favicon-32x32.png', '/apple-touch-icon.png']) {
      expect(html).toContain(`href="${f}"`);
      expect(existsSync('public' + f)).toBe(true);
    }
  });
});
