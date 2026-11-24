import { useEffect, useState } from 'react';

import { MOTION } from '@/features/morning-feed/motion-tokens';
import { SkeletonLines } from '@/features/morning-feed/SkeletonLines';

/*
 * While a brief is read (decision 2026-11-14 "앱처럼 반응"): never a blank screen. Faint lines
 * stand where the headline and the text will be; when the brief arrives within the skeleton
 * wait, the lines are skipped and only the background shows for that moment.
 */
export function PageSkeleton(): JSX.Element {
  const [lines, setLines] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLines(true), MOTION.wait.skeletonAfterMs);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="mf-w3-root mf-home mf-page" data-testid="mf-page-wait">
      <div className="mf-page-scroll">
        <div className="mf-page-top" />
        {lines ? (
          <div className="mf-page-skel" style={{ position: 'relative' }}>
            <SkeletonLines testId="mf-page-skeleton" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
