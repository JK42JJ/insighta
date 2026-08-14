// Lenient JSON salvage for LLM output (CP504 §11).
//
// LLMs (Sonnet/Haiku) intermittently corrupt otherwise-valid JSON in two ways:
//   1. a raw newline INSIDE a string value (JSON forbids it → JSON.parse trips)
//   2. a maxTokens truncation that cuts the object mid-way (unclosed brackets)
//
// Both were previously "handled" by burning an LLM RETRY (topic-synthesis /
// book-skeleton re-called Sonnet on a parse failure) — cost hiding a bug. These
// helpers salvage the SAME response in-process (no new LLM call), so a parse
// failure stops being a retry reason. Extracted from mandala/generator.ts, whose
// robust-extract pipeline proved the string-context-aware algorithms; both
// modules now share one copy.

/**
 * Escape unescaped newline / carriage-return chars that appear INSIDE a JSON
 * string literal, so JSON.parse survives an LLM that emitted a literal newline
 * in a string value. String-context aware: only touches chars inside a "..."
 * literal, never structural whitespace. Content is preserved (the newline is
 * restored on parse as a real \n — no text is lost).
 */
export function escapeUnescapedJsonNewlines(text: string): string {
  let result = '';
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (esc) {
      result += ch;
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      result += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      result += ch;
      continue;
    }
    if (inStr && (ch === '\n' || ch === '\r')) {
      result += ch === '\n' ? '\\n' : '\\r';
      continue;
    }
    result += ch;
  }
  return result;
}

/**
 * Append the closing brackets/braces a truncated JSON prefix is missing
 * (string-context aware), salvaging a maxTokens-truncated response into a
 * parseable — if partial — object. Never removes content; only closes.
 */
export function closeUnclosedJsonBrackets(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\' && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack.length > 0 && stack[stack.length - 1] === ch) {
      stack.pop();
    }
  }
  let result = text;
  while (stack.length > 0) result += stack.pop();
  return result;
}

/** How a lenient parse was recovered (for the parse-recovery counter). */
export type JsonSalvageVia = 'newline' | 'truncation';

/**
 * Parse JSON an LLM may have corrupted with unescaped newlines or a maxTokens
 * truncation. Order: direct → newline-escaped → newline-escaped + bracket-closed.
 * Returns the parsed value, or null (caller decides the honest fail). `onSalvage`
 * fires with the technique that worked — this is the parse-recovery signal that
 * replaces the old LLM retry (verify it stays low/zero after the §11 fix).
 */
export function parseJsonLenient<T>(
  stripped: string,
  onSalvage?: (via: JsonSalvageVia) => void
): T | null {
  try {
    return JSON.parse(stripped) as T;
  } catch {
    /* corrupted — try salvage below */
  }
  const escaped = escapeUnescapedJsonNewlines(stripped);
  if (escaped !== stripped) {
    try {
      const v = JSON.parse(escaped) as T;
      onSalvage?.('newline');
      return v;
    } catch {
      /* newline alone did not fix it — try truncation-close too */
    }
  }
  const closed = closeUnclosedJsonBrackets(escaped);
  if (closed !== escaped) {
    try {
      const v = JSON.parse(closed) as T;
      onSalvage?.('truncation');
      return v;
    } catch {
      /* give up — genuinely malformed */
    }
  }
  return null;
}
