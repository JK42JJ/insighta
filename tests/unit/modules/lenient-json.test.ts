/**
 * lenient-json (CP504 §11) — salvage LLM-corrupted JSON WITHOUT an LLM retry.
 * Pure string util (no env / no LLM). Locks: unescaped-newline escape, truncation
 * bracket-close, string-context awareness (never touches structural whitespace),
 * salvage-signal callback, and honest null on genuinely-malformed input.
 */

import {
  escapeUnescapedJsonNewlines,
  closeUnclosedJsonBrackets,
  parseJsonLenient,
} from '../../../src/utils/lenient-json';

describe('escapeUnescapedJsonNewlines', () => {
  it('escapes a raw newline INSIDE a string value so JSON.parse survives', () => {
    const bad = '{"a":"line1\nline2"}';
    expect(() => JSON.parse(bad)).toThrow(); // raw newline is invalid JSON
    const fixed = escapeUnescapedJsonNewlines(bad);
    expect(JSON.parse(fixed)).toEqual({ a: 'line1\nline2' }); // newline preserved (no loss)
  });

  it('handles \\r and leaves structural whitespace (outside strings) untouched', () => {
    const bad = '{\n  "a":"x\ry"\n}';
    const fixed = escapeUnescapedJsonNewlines(bad);
    expect(JSON.parse(fixed)).toEqual({ a: 'x\ry' });
  });

  it('does not double-escape an already-escaped newline', () => {
    const good = '{"a":"line1\\nline2"}'; // already-valid \n escape
    expect(escapeUnescapedJsonNewlines(good)).toBe(good);
    expect(JSON.parse(escapeUnescapedJsonNewlines(good))).toEqual({ a: 'line1\nline2' });
  });
});

describe('closeUnclosedJsonBrackets', () => {
  it('closes a truncated object/array prefix into a parseable value', () => {
    const truncated = '{"sections":[{"title":"T","atom_idx":[0,1';
    const closed = closeUnclosedJsonBrackets(truncated);
    expect(JSON.parse(closed)).toEqual({ sections: [{ title: 'T', atom_idx: [0, 1] }] });
  });

  it('leaves already-balanced JSON unchanged', () => {
    const ok = '{"a":[1,2]}';
    expect(closeUnclosedJsonBrackets(ok)).toBe(ok);
  });

  it('does not count brackets that appear inside string values', () => {
    const s = '{"a":"has ] and } inside"';
    expect(JSON.parse(closeUnclosedJsonBrackets(s))).toEqual({ a: 'has ] and } inside' });
  });
});

describe('parseJsonLenient', () => {
  it('returns the value on clean JSON without invoking salvage', () => {
    const onSalvage = jest.fn();
    expect(parseJsonLenient('{"x":1}', onSalvage)).toEqual({ x: 1 });
    expect(onSalvage).not.toHaveBeenCalled();
  });

  it('salvages an unescaped newline and reports via="newline"', () => {
    const onSalvage = jest.fn();
    const v = parseJsonLenient<{ a: string }>('{"a":"l1\nl2"}', onSalvage);
    expect(v).toEqual({ a: 'l1\nl2' });
    expect(onSalvage).toHaveBeenCalledWith('newline');
  });

  it('salvages a truncation and reports via="truncation"', () => {
    const onSalvage = jest.fn();
    const v = parseJsonLenient<{ a: number[] }>('{"a":[1,2', onSalvage);
    expect(v).toEqual({ a: [1, 2] });
    expect(onSalvage).toHaveBeenCalledWith('truncation');
  });

  it('returns null (honest fail) on genuinely malformed input', () => {
    const onSalvage = jest.fn();
    expect(parseJsonLenient('not json at all }{', onSalvage)).toBeNull();
  });
});
