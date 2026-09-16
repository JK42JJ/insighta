import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * Whether a CSS media query currently matches, kept current on change.
 *
 * Returns false where `matchMedia` does not exist (server render, some test
 * environments), so a caller that branches on it gets the narrow layout
 * rather than a throw.
 */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setValue(event.matches);
    setValue(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return value;
}
