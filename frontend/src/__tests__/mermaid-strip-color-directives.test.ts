/**
 * mermaid-strip-color-directives — locks the contrast fix (CONTRAST FIX).
 *
 * LLM-generated mermaid embeds `style/classDef/linkStyle` color directives whose
 * pastel fills collide with the theme's light node text → invisible labels.
 * stripMermaidColorDirectives() removes ONLY those directives, preserving all
 * structure (nodes, edges, labels, subgraphs, `class X y` assignments).
 */
import { describe, it, expect } from 'vitest';
import { stripMermaidColorDirectives } from '@/pages/learning/lib/mermaid-block';

describe('stripMermaidColorDirectives', () => {
  it('removes style / classDef / linkStyle lines', () => {
    const out = stripMermaidColorDirectives(
      [
        'flowchart LR',
        '  style A fill:#d0e8ff,stroke:#4a90d9',
        '  classDef hot fill:#fee,stroke:#900',
        '  linkStyle 0 stroke:#f00,stroke-width:2px',
      ].join('\n')
    );
    expect(out).not.toMatch(/style/);
    expect(out).not.toMatch(/classDef/);
    expect(out).not.toMatch(/linkStyle/);
    expect(out).toBe('flowchart LR');
  });

  it('preserves flowchart nodes, edges, and labels', () => {
    const src = 'flowchart LR\n A["Start"] -->|"go"| B["End"]';
    expect(stripMermaidColorDirectives(src)).toBe(src);
  });

  it('preserves subgraphs and harmless `class X y` assignments', () => {
    const src = [
      'flowchart TD',
      '  subgraph S["Pipeline"]',
      '    A --> B',
      '  end',
      '  class A important',
    ].join('\n');
    expect(stripMermaidColorDirectives(src)).toBe(src);
  });

  it('strips a realistic LLM diagram down to just the structure', () => {
    const src = [
      'flowchart LR',
      ' A["x"] -->|"y"| B["z"]',
      ' style A fill:#d0e8ff,stroke:#4a90d9',
    ].join('\n');
    expect(stripMermaidColorDirectives(src)).toBe('flowchart LR\n A["x"] -->|"y"| B["z"]');
  });

  it('does not touch node labels that merely contain the word "style"', () => {
    const src = 'flowchart LR\n A["Style guide"] --> B["Done"]';
    expect(stripMermaidColorDirectives(src)).toBe(src);
  });
});
