import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_GUARD_KEY = 'umbras_dynamic_import_reload_at';
const RELOAD_COOLDOWN_MS = 15_000;

export function isDynamicImportError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : '';

  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \d+ failed|Outdated Optimize Dep|Cannot read properties of null \(reading '(?:useMemo|useState|useEffect|useRef|useCallback|useContext|useReducer)'\)|Invalid hook call/i.test(
    message
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function trySingleReload(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    const lastReloadAt = raw ? Number(raw) : 0;
    const now = Date.now();
    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < RELOAD_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    const retryDelays = [250, 600];
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const mod = await importer();
        try {
          window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
        } catch {
          // Ignore storage restrictions
        }
        return mod;
      } catch (error) {
        lastError = error;
        if (!isDynamicImportError(error)) {
          throw error;
        }
        if (attempt < retryDelays.length) {
          await wait(retryDelays[attempt]);
        }
      }
    }

    if (isDynamicImportError(lastError) && trySingleReload()) {
      // Keep Suspense fallback visible while the browser completes the reload.
      return new Promise<{ default: T }>(() => {});
    }

    throw lastError;
  });
}
