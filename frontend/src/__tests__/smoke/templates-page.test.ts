/**
 * TemplatesPage smoke contract
 *
 * Locks in the CP454 marketing /templates page guarantees so future edits do
 * not silently re-collapse it into /explore:
 *   1. The page exists and default-exports a component named `TemplatesPage`.
 *   2. It uses the public-templates hook (no auth required), not the
 *      authenticated `useExploreMandalas` hook.
 *   3. It does not expose owner-vs-other editing affordances
 *      (handleEdit / handleDelete / mine source / deletingIds).
 *   4. Anonymous "Start" CTA routes to /login with a returnTo back to
 *      /templates (marketing funnel guarantee).
 *   5. Router wires /templates and /templates/:slug to TemplatesPage
 *      (no `Navigate to="/explore"` redirect).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PAGE_PATH = path.resolve(__dirname, '../../pages/templates/ui/TemplatesPage.tsx');
const INDEX_PATH = path.resolve(__dirname, '../../pages/templates/index.ts');
const HOOK_PATH = path.resolve(__dirname, '../../features/templates/model/useTemplatesPublic.ts');
const ROUTER_PATH = path.resolve(__dirname, '../../app/router/index.tsx');

describe('TemplatesPage marketing /templates page', () => {
  it('page file exists and default-exports TemplatesPage', () => {
    expect(fs.existsSync(PAGE_PATH)).toBe(true);
    const content = fs.readFileSync(PAGE_PATH, 'utf-8');
    expect(content).toMatch(/export default function TemplatesPage/);
  });

  it('index.ts re-exports the page default', () => {
    expect(fs.existsSync(INDEX_PATH)).toBe(true);
    const content = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(content).toContain("from './ui/TemplatesPage'");
  });

  it('uses useTemplatesPublic (not useExploreMandalas)', () => {
    const content = fs.readFileSync(PAGE_PATH, 'utf-8');
    expect(content).toContain('useTemplatesPublic');
    expect(content).not.toMatch(/\buseExploreMandalas\b/);
  });

  it('useTemplatesPublic hits /mandalas/templates-public via apiClient', () => {
    expect(fs.existsSync(HOOK_PATH)).toBe(true);
    const content = fs.readFileSync(HOOK_PATH, 'utf-8');
    expect(content).toContain('apiClient.listPublicTemplates');
  });

  it('does not expose owner/mine/edit/delete affordances', () => {
    const content = fs.readFileSync(PAGE_PATH, 'utf-8');
    expect(content).not.toMatch(/\bhandleEdit\b/);
    expect(content).not.toMatch(/\bhandleDelete\b/);
    expect(content).not.toMatch(/\bdeletingIds\b/);
    expect(content).not.toMatch(/\bisMine\b/);
  });

  it('anonymous Start CTA returns to /templates after login', () => {
    const content = fs.readFileSync(PAGE_PATH, 'utf-8');
    expect(content).toContain('/login?returnTo=');
    expect(content).toMatch(/RETURN_TO_PATH\s*=\s*'\/templates'/);
  });

  it('router wires /templates and /templates/:slug to TemplatesPage', () => {
    const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
    expect(content).toContain("import('@/pages/templates')");
    expect(content).toMatch(/path="\/templates"\s+element=\{<TemplatesPage \/>\}/);
    expect(content).toMatch(/path="\/templates\/:slug"\s+element=\{<TemplatesPage \/>\}/);
    // No leftover redirect to /explore for marketing routes.
    expect(content).not.toMatch(/path="\/templates"\s+element=\{<Navigate to="\/explore"/);
  });
});
