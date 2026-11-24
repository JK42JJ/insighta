/** Faint lines where a headline and its text will be (decision 2026-11-14). */
export function SkeletonLines({ testId }: { testId?: string }): JSX.Element {
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
