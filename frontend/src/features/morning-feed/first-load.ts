import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/*
 * The first reads of the app on a phone: one lost request must never leave a blank screen (found
 * 2026-11-25: a failed flag check drew nothing, for good). They are tried again until they answer,
 * sooner when the connection comes back; the logo stays meanwhile.
 */

/** Waits between tries (ms); the last one repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [800, 1500, 3000, 5000];
/** After this many failed tries the screen says so (and goes on trying). */
export const TELL_AFTER_TRIES = 6;

export function retryDelay(tries: number): number {
  return RETRY_DELAYS_MS[Math.min(tries, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0]!;
}

/** Waits, or until the browser is online again. */
function waitOrOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      window.clearTimeout(t);
      window.removeEventListener('online', done);
      resolve();
    };
    const t = window.setTimeout(done, ms);
    window.addEventListener('online', done);
  });
}

/** Calls `read` until it answers or `alive` is false (then it never resolves). */
export async function keepTrying<T>(
  read: () => Promise<T>,
  alive: () => boolean,
  onFailed?: (tries: number) => void
): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await read();
    } catch {
      if (!alive()) return new Promise<T>(() => undefined);
      onFailed?.(tries);
      await waitOrOnline(retryDelay(tries));
      if (!alive()) return new Promise<T>(() => undefined);
    }
  }
}

const CHUNK_TRIES = 3;
const RELOADED_KEY = 'insighta-chunk-reload';
/** A second reload for the same cause is not tried within this time. */
const RELOAD_AGAIN_MS = 60_000;

/** A code chunk that does not load: tried again; still missing (a new deploy) -> the page is loaded anew once. */
export async function loadChunk<T>(
  load: () => Promise<T>,
  reload: () => void = () => window.location.reload()
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await load();
    } catch (e) {
      if (i < CHUNK_TRIES) {
        await waitOrOnline(retryDelay(i));
        continue;
      }
      let last = 0;
      try {
        last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? 0);
        if (Date.now() - last > RELOAD_AGAIN_MS) {
          window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
          reload();
          return new Promise<T>(() => undefined);
        }
      } catch {
        /* storage blocked: the app's error screen shows */
      }
      throw e;
    }
  }
}

export function lazyScreen<P>(
  load: () => Promise<{ default: ComponentType<P> }>
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => loadChunk(load));
}
