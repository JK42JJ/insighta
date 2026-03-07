import { useState, useEffect, type RefObject } from 'react';

function getColumnCount(width: number): number {
  if (width < 640) return 1;
  if (width < 768) return 2;
  if (width < 1280) return 3;
  return 4;
}

export function useColumnCount(containerRef: RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(3);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setColumns(getColumnCount(el.offsetWidth));

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null) {
        setColumns(getColumnCount(width));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  return columns;
}
