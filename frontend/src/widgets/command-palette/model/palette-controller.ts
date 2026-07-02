/**
 * Module-level open-controller for the ⌘K CommandPalette — lets any surface
 * (sidebar trigger, collapsed icon) open the palette without prop drilling.
 * Same module-level-ref pattern as shellStore.dndHandlersRef.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function openCommandPalette(): void {
  listeners.forEach((l) => l());
}

export function subscribePaletteOpen(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
