import { create, type StateCreator } from 'zustand';
import { persist, createJSONStorage, type PersistOptions } from 'zustand/middleware';

/** Storage namespaces. Every persisted key is `lp:<namespace>:<name>`. */
export type ProgressNamespace = 'dsa' | 'sd' | 'kafka' | 'sql' | 'dm' | 'desd' | 'app' | 'java';

export const STORAGE_PREFIX = 'lp:';

export function storageKey(namespace: ProgressNamespace, name: string): string {
  return `${STORAGE_PREFIX}${namespace}:${name}`;
}

export interface PersistedStoreOptions<T> {
  /** Bump when the persisted shape changes; pair with `migrate`. */
  version?: number;
  migrate?: PersistOptions<T, Partial<T>>['migrate'];
  /** Choose which fields to persist (default: all non-function fields). */
  partialize?: (state: T) => Partial<T>;
}

/**
 * Create a zustand store persisted to localStorage under `lp:<namespace>:<name>`.
 *
 * @example
 * const useDsaProgress = createPersistedStore('dsa', 'progress', (set) => ({
 *   solved: {} as Record<string, boolean>,
 *   markSolved: (id: string) => set((s) => ({ solved: { ...s.solved, [id]: true } })),
 * }));
 */
export function createPersistedStore<T>(
  namespace: ProgressNamespace,
  name: string,
  initializer: StateCreator<T, [['zustand/persist', unknown]], []>,
  options: PersistedStoreOptions<T> = {},
) {
  return create<T>()(
    persist(initializer, {
      name: storageKey(namespace, name),
      storage: createJSONStorage(() => localStorage),
      version: options.version ?? 0,
      // Only pass optional hooks when defined: explicit `undefined` overrides zustand's defaults.
      ...(options.migrate && { migrate: options.migrate }),
      ...(options.partialize && { partialize: options.partialize }),
    }),
  );
}

/** All localStorage keys owned by this app (optionally filtered by namespace). */
export function listStorageKeys(namespace?: ProgressNamespace): string[] {
  const prefix = namespace ? `${STORAGE_PREFIX}${namespace}:` : STORAGE_PREFIX;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys.sort();
}

export interface ProgressExport {
  app: 'learning-playground';
  format: 1;
  exportedAt: string;
  data: Record<string, string>;
}

export function exportProgress(): ProgressExport {
  const data: Record<string, string> = {};
  for (const k of listStorageKeys()) data[k] = localStorage.getItem(k) ?? '';
  return { app: 'learning-playground', format: 1, exportedAt: new Date().toISOString(), data };
}

/** Writes every `lp:*` key from an export. Returns number of keys imported. Reload afterwards. */
export function importProgress(payload: unknown, { replace = true } = {}): number {
  const p = payload as Partial<ProgressExport> | null;
  if (!p || p.app !== 'learning-playground' || typeof p.data !== 'object' || p.data === null) {
    throw new Error('Not a learning-playground progress file.');
  }
  const entries = Object.entries(p.data).filter(
    ([k, v]) => k.startsWith(STORAGE_PREFIX) && typeof v === 'string',
  );
  if (replace) resetProgress();
  for (const [k, v] of entries) localStorage.setItem(k, v);
  return entries.length;
}

/** Removes persisted keys (all, or one namespace). Reload afterwards so stores re-initialise. */
export function resetProgress(namespace?: ProgressNamespace): number {
  const keys = listStorageKeys(namespace);
  for (const k of keys) localStorage.removeItem(k);
  return keys.length;
}
