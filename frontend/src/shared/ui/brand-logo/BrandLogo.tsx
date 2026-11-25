import './brand-logo.css';

/** Design handoff 2026-11-25 (assets/logo/README.md, "1b 각주 i · 미네랄 블루"): word 17px, symbol 20px, gap 5px. */
const WORD_PX = 17;
const SYMBOL_PX = 20;
const GAP_PX = 5;
/** Empty part left of the symbol's stroke (12 of 48): pulled out, so the stroke is on the content edge. */
const SYMBOL_INSET = 12 / 48;
/** Accessible name of the brand; the drawn word is lower case. */
export const BRAND_NAME = 'Insighta';

/**
 * The Insighta lockup: the symbol (an ink stroke and a mineral-blue dot) and the word. `dark` is for
 * dark grounds. `word` = the word's size in px; the symbol and the gap keep their proportions.
 */
export function BrandLogo({
  dark = false,
  word = WORD_PX,
  symbolOnly = false,
}: {
  dark?: boolean;
  word?: number;
  symbolOnly?: boolean;
}): JSX.Element {
  const k = word / WORD_PX;
  return (
    <span
      className="brand-logo"
      data-dark={dark ? '' : undefined}
      data-testid="brand-logo"
      style={{ gap: GAP_PX * k, fontSize: word, marginLeft: -SYMBOL_PX * k * SYMBOL_INSET }}
    >
      <svg
        width={SYMBOL_PX * k}
        height={SYMBOL_PX * k}
        viewBox="0 0 48 48"
        role={symbolOnly ? 'img' : undefined}
        aria-label={symbolOnly ? BRAND_NAME : undefined}
        aria-hidden={symbolOnly ? undefined : true}
      >
        <rect className="brand-logo-stroke" x="12" y="20" width="11" height="22" rx="5.5" />
        <circle className="brand-logo-dot" cx="30" cy="12" r="6.5" />
      </svg>
      {symbolOnly ? null : (
        <span className="brand-logo-word" aria-label={BRAND_NAME}>
          insighta
        </span>
      )}
    </span>
  );
}
