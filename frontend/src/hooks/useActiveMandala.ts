/**
 * useActiveMandala Hook
 *
 * Manages the currently active (selected) mandala ID.
 * Defaults to the user's default mandala.
 */

import { useState, useEffect } from 'react';
import { useMandalas } from './useMandalas';

export function useActiveMandala() {
  const { mandalas } = useMandalas();
  const defaultMandala = mandalas.find((m) => m.isDefault) ?? mandalas[0];

  const [activeMandalaId, setActiveMandalaId] = useState<string | undefined>(undefined);

  // Sync with default mandala when mandalas load or change
  useEffect(() => {
    if (!activeMandalaId && defaultMandala) {
      setActiveMandalaId(defaultMandala.id);
    }
  }, [defaultMandala?.id, activeMandalaId]);

  // If active mandala was deleted, fallback to default
  useEffect(() => {
    if (activeMandalaId && mandalas.length > 0 && !mandalas.some((m) => m.id === activeMandalaId)) {
      setActiveMandalaId(defaultMandala?.id);
    }
  }, [activeMandalaId, mandalas, defaultMandala?.id]);

  const activeMandala = mandalas.find((m) => m.id === activeMandalaId) ?? defaultMandala ?? null;

  return {
    activeMandalaId,
    activeMandala,
    setActiveMandalaId,
  };
}
