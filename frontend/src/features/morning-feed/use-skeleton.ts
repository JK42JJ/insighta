import { useEffect, useState } from 'react';

import { MOTION } from '@/features/morning-feed/motion-tokens';

/**
 * True once the content has been waited for longer than the skeleton wait and is still not
 * ready (decision 2026-11-14): quicker content never shows the placeholder lines.
 */
export function useSkeleton(ready: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (ready) return undefined;
    const t = window.setTimeout(() => setLate(true), MOTION.wait.skeletonAfterMs);
    return () => window.clearTimeout(t);
  }, [ready]);
  return late && !ready;
}
