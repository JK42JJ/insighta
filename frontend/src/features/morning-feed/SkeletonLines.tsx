/** Text lines of the brief's first paragraphs. */
const BODY_WIDTHS = ['100%', '94%', '98%', '88%', '62%'] as const;

/**
 * Faint lines where a headline and its text will be (decision 2026-11-14); `body` = the text's
 * lines alone, in the text's own place.
 */
export function SkeletonLines({
  testId,
  body = false,
}: {
  testId?: string;
  body?: boolean;
}): JSX.Element {
  if (body)
    return (
      <div className="mf-skel" data-testid={testId} aria-hidden="true">
        {BODY_WIDTHS.map((width, i) => (
          <div key={i} className="mf-skel-line" style={{ width }} />
        ))}
      </div>
    );
  return (
    <div className="mf-skel mf-skel-over" data-testid={testId} aria-hidden="true">
      <div className="mf-skel-line" style={{ width: '34%' }} />
      <div className="mf-skel-line" data-big="" style={{ width: '92%' }} />
      <div className="mf-skel-line" data-big="" style={{ width: '70%' }} />
      <div className="mf-skel-line" style={{ width: '100%' }} />
      <div className="mf-skel-line" style={{ width: '88%' }} />
    </div>
  );
}
