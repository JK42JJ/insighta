import type { CiteLink } from '@/features/morning-feed/watch-page-model';

/**
 * The source links drawn after each sentence until 2026-11-25.
 * @deprecated Sources open from the sentence itself (order 2026-11-25 B5); not used.
 */
export function PageCites({ links }: { links: CiteLink[] }): JSX.Element {
  const groups: CiteLink[][] = [];
  for (const c of links) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.videoId === c.videoId) last.push(c);
    else groups.push([c]);
  }
  return (
    <>
      {groups.map((g, k) => (
        <span key={k} className="mf-page-cite-group">
          {g.map((c, i) => (
            <a
              key={i}
              className="mf-page-cite"
              data-press="link"
              data-gap={c.gap}
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {c.label}
            </a>
          ))}
        </span>
      ))}
    </>
  );
}
