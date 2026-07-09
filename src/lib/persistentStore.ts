/**
 * Durable persistence for user-owned state.
 *
 * localStorage alone is a cache, not a database — clearing the webview wipes
 * commitment history, learned feedback, contact memory, and CRM edits. This
 * layer keeps localStorage as the synchronous working copy (so nothing about
 * how stores read state changes) and mirrors every write to disk via the
 * Tauri `save_app_data` command (~/.config/aiden/app_data/). On boot,
 * `hydrateDurableState()` copies disk → localStorage before the app renders,
 * so a cleared webview recovers silently. In a plain browser (no Tauri) all
 * of this degrades to localStorage-only — identical to the old behavior.
 */

/** localStorage keys that must survive a cleared webview. */
export const DURABLE_KEYS = [
  'aiden.commitment.overrides',
  'aiden-feedback',
  'aiden-contact-memory',
  'aiden.crm.overrides',
  'aiden_dismissed_focus',
] as const;

// Disk filenames must be [A-Za-z0-9-_] (enforced by the Rust command).
function diskKey(storageKey: string): string {
  return storageKey.replace(/[^A-Za-z0-9-_]/g, '-');
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
let invokePromise: Promise<InvokeFn | null> | null = null;

function getInvoke(): Promise<InvokeFn | null> {
  if (!invokePromise) {
    invokePromise = import('@tauri-apps/api/core')
      .then((m) => m.invoke as InvokeFn)
      .catch(() => null);
  }
  return invokePromise;
}

/** Fire-and-forget mirror of a raw string value to disk. */
export function mirrorToDisk(storageKey: string, raw: string): void {
  getInvoke()
    .then((invoke) => invoke?.('save_app_data', { key: diskKey(storageKey), json: raw }))
    .catch(() => {
      /* not in Tauri / disk unavailable — cache-only mode */
    });
}

/** Write to the localStorage cache AND mirror to disk. Use for every durable write. */
export function setDurable(storageKey: string, raw: string): void {
  try {
    localStorage.setItem(storageKey, raw);
  } catch {
    /* quota / private mode — disk mirror below still preserves it */
  }
  mirrorToDisk(storageKey, raw);
}

/**
 * Boot hydration: for each durable key, disk wins (it survived; the cache may
 * have been cleared). If disk has nothing but the cache does (first run after
 * this upgrade), migrate the cache up to disk.
 */
export async function hydrateDurableState(keys: readonly string[] = DURABLE_KEYS): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return; // plain browser — cache is all there is
  await Promise.all(
    keys.map(async (key) => {
      try {
        const raw = (await invoke('load_app_data', { key: diskKey(key) })) as string | null;
        if (typeof raw === 'string' && raw.length > 0) {
          localStorage.setItem(key, raw);
        } else {
          const cached = localStorage.getItem(key);
          if (cached) mirrorToDisk(key, cached);
        }
      } catch {
        /* disk unavailable for this key — keep whatever the cache has */
      }
    }),
  );
}

/**
 * zustand `persist` storage adapter: reads stay synchronous via localStorage;
 * writes mirror to disk. Pair with a post-hydration `store.persist.rehydrate()`
 * so persisted stores pick up disk state that arrived after module init.
 */
export const durableStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    setDurable(name, value);
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
    mirrorToDisk(name, '');
  },
};
