/**
 * URL → store bridge.
 *
 * Watches the current location for `/notes/:cardId` and opens/closes the
 * Zustand store accordingly. Reads optional `?mandala=<id>` from the query
 * string so scratchpad cards (no mandala) are fully supported.
 *
 * Mounted once at the app root (App.tsx) so that it works on every page.
 */
import { useEffect } from 'react';
import { useMatch, useSearchParams } from 'react-router-dom';
import { useSideEditorStore } from '../model/useSideEditorStore';

const ROUTE_PATTERN = '/notes/:cardId';

export function SideEditorRouteAdapter() {
  const match = useMatch(ROUTE_PATTERN);
  const [searchParams] = useSearchParams();
  const open = useSideEditorStore((s) => s.open);
  const close = useSideEditorStore((s) => s.close);

  useEffect(() => {
    if (match?.params.cardId) {
      open({
        cardId: match.params.cardId,
        mandalaId: searchParams.get('mandala'),
      });
      return () => {
        close();
      };
    }
    return undefined;
  }, [match?.params.cardId, searchParams, open, close]);

  return null;
}
