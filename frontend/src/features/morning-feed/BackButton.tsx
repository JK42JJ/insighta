/*
 * Top-left back on the brief and past-brief screens (decision 2026-11-14 user test): the same
 * arrow as the video screen's back, followed by the name of the screen it returns to ("‹ 홈").
 */
export function BackButton({
  label,
  onBack,
  testId,
}: {
  label: string;
  onBack: () => void;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className="mf-back"
      data-press="icon"
      data-testid={testId}
      aria-label={label + '(으)로 돌아가기'}
      onClick={onBack}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 4l-6 6 6 6" />
      </svg>
      <span className="mf-back-label">{label}</span>
    </button>
  );
}
