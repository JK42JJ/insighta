/**
 * DndContext Structure Guard — ensures DndContext lives in AppShell
 * and wraps both Sidebar and main content.
 *
 * If this test fails, D&D between sidebar and grid is broken.
 * See: CP324 (2026-03-30) — AppShell lift broke sidebar D&D.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_SRC = path.resolve(__dirname, '../..');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(FRONTEND_SRC, relativePath), 'utf-8');
}

describe('DndContext Structure Guard', () => {
  it('AppShell.tsx must contain DndContext', () => {
    const content = readFile('widgets/app-shell/ui/AppShell.tsx');
    expect(content).toContain('<DndContext');
    expect(content).toContain('</DndContext>');
  });

  it('IndexPage.tsx must NOT contain DndContext', () => {
    const content = readFile('pages/index/ui/IndexPage.tsx');
    expect(content).not.toContain('<DndContext');
    expect(content).not.toContain('</DndContext>');
  });

  it('AppShell.tsx must import DndContext from dnd-kit', () => {
    const content = readFile('widgets/app-shell/ui/AppShell.tsx');
    expect(content).toMatch(/import\s*\{[^}]*DndContext[^}]*\}\s*from\s*['"]@dnd-kit\/core['"]/);
  });

  it('AppShell.tsx must use dndHandlersRef for handler delegation', () => {
    const content = readFile('widgets/app-shell/ui/AppShell.tsx');
    expect(content).toContain('dndHandlersRef');
  });

  it('shellStore.ts must export dndHandlersRef', () => {
    const content = readFile('stores/shellStore.ts');
    expect(content).toContain('export const dndHandlersRef');
  });

  it('IndexPage.tsx must set dndHandlersRef.current during render', () => {
    const content = readFile('pages/index/ui/IndexPage.tsx');
    expect(content).toContain('dndHandlersRef.current');
  });

  it('minimapData useEffect must include cardsByCell in deps', () => {
    const content = readFile('pages/index/ui/IndexPage.tsx');
    // Find the minimapData effect and verify cardsByCell is in the deps array
    const minimapEffectMatch = content.match(
      /setMinimapData\(\{[\s\S]*?cardsByCell[\s\S]*?\}\);[\s\S]*?\}, \[([\s\S]*?)\]/
    );
    expect(minimapEffectMatch).not.toBeNull();
    expect(minimapEffectMatch![1]).toContain('cards.cardsByCell');
  });
});

describe('External D&D Handler Guard', () => {
  it('CardListView must have onExternalUrlDrop prop and handlers', () => {
    const content = readFile('widgets/card-list-view/ui/CardListView.tsx');
    expect(content).toContain('onExternalUrlDrop');
    expect(content).toContain('onDragOver={handleExternalDragOver}');
    expect(content).toContain('onDrop={handleExternalDrop}');
  });

  it('CardListView must use extractUrlFromDragData for URL extraction', () => {
    const content = readFile('widgets/card-list-view/ui/CardListView.tsx');
    expect(content).toContain('extractUrlFromDragData');
    expect(content).toContain('extractUrlFromHtml');
  });

  it('SidebarHeatMinimap must have onExternalUrlDrop prop and handlers', () => {
    const content = readFile('widgets/sidebar-heat-minimap/ui/SidebarHeatMinimap.tsx');
    expect(content).toContain('onExternalUrlDrop');
    expect(content).toContain('onDragOver={handleExternalDragOver}');
    expect(content).toContain('onDrop={handleExternalDrop}');
  });

  it('IndexPage must pass onExternalUrlDrop to CardListView and minimapData', () => {
    const content = readFile('pages/index/ui/IndexPage.tsx');
    expect(content).toContain('onExternalUrlDrop={');
    const minimapBlock = content.match(/setMinimapData\(\{([\s\S]*?)\}\);/);
    expect(minimapBlock).not.toBeNull();
    expect(minimapBlock![1]).toContain('onExternalUrlDrop');
  });

  it('IndexPage must NOT have external DropZoneOverlay (only internal)', () => {
    const content = readFile('pages/index/ui/IndexPage.tsx');
    const overlayMatches = content.match(/<DropZoneOverlay/g);
    expect(overlayMatches?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
