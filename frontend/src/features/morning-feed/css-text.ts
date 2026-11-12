import type { CSSProperties } from 'react';

/**
 * Turns a CSS declaration string (the form the design reference uses) into a React
 * style object, so values are copied from the reference as written.
 */
export function cssText(text: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const at = decl.indexOf(':');
    if (at < 0) continue;
    const name = decl.slice(0, at).trim();
    const value = decl.slice(at + 1).trim();
    if (!name || !value) continue;
    out[toKey(name)] = value;
  }
  return out as CSSProperties;
}

function toKey(name: string): string {
  if (name.startsWith('--')) return name;
  const vendor = name.startsWith('-webkit-');
  const base = vendor ? name.slice('-webkit-'.length) : name;
  const camel = base.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  return vendor ? 'Webkit' + camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
}
