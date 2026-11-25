import { SkeletonLines } from '@/features/morning-feed/SkeletonLines';

/*
 * The brief's text while it is still being read (decision 2026-11-25): faint lines in the text's
 * own place only. The date and the title above them are drawn as they will stay, so there is
 * never a screen of lines alone.
 */
export function PageSkeleton(): JSX.Element {
  return (
    <div className="mf-page-skel" data-testid="mf-page-wait">
      <SkeletonLines testId="mf-page-skeleton" body />
    </div>
  );
}
