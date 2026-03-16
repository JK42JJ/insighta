/**
 * Returns {top, left} pixel coordinates of a character position
 * inside a <textarea>, measured relative to the textarea element.
 *
 * Technique: create a hidden mirror div with identical computed styles,
 * insert text up to `position`, then read offsetTop/offsetLeft of a
 * trailing <span>.  Lightweight replacement for the `textarea-caret`
 * npm package (~40 lines).
 */

const MIRROR_STYLE_PROPS = [
  'direction', 'boxSizing', 'width', 'height',
  'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
  'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'textDecoration',
  'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize',
  'whiteSpace', 'wordWrap', 'wordBreak',
] as const;

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const div = document.createElement('div');
  div.id = 'caret-mirror';

  const style = div.style;
  const computed = getComputedStyle(textarea);

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.overflow = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  for (const prop of MIRROR_STYLE_PROPS) {
    (style as any)[prop] = (computed as any)[prop];
  }

  div.textContent = textarea.value.substring(0, position);

  const span = document.createElement('span');
  span.textContent = textarea.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);

  const top = span.offsetTop;
  const left = span.offsetLeft;

  document.body.removeChild(div);

  return { top, left };
}
