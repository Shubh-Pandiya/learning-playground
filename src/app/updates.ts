import { create } from 'zustand';
import { createPersistedStore } from '@/shared/progress';
import type { UpdateStatus } from '../../scripts/auto-update';

export type { UpdateStatus };

interface UpdatesState {
  /** `false` when the dev-server endpoint doesn't exist (e.g. a static build). */
  available: boolean | null;
  status: UpdateStatus | null;
  checking: boolean;
  refresh: () => Promise<void>;
  checkNow: () => Promise<void>;
}

async function getJson(input: string, init?: RequestInit): Promise<UpdateStatus | null> {
  const res = await fetch(input, { cache: 'no-store', ...init });
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
  return (await res.json()) as UpdateStatus;
}

export const useUpdates = create<UpdatesState>()((set) => ({
  available: null,
  status: null,
  checking: false,
  refresh: async () => {
    try {
      const status = await getJson('/__updates');
      set(status ? { available: true, status } : { available: false });
    } catch {
      /* server restarting or offline: keep the last known status */
    }
  },
  checkNow: async () => {
    set({ checking: true });
    try {
      const status = await getJson('/__updates/check', { method: 'POST' });
      if (status) set({ available: true, status });
    } catch {
      /* ignore */
    } finally {
      set({ checking: false });
    }
  },
}));

let started = false;
/** Start polling once per page (cheap: the server only reads cached state). */
export function startUpdatePolling() {
  if (started) return;
  started = true;
  const { refresh } = useUpdates.getState();
  void refresh();
  setInterval(() => {
    if (useUpdates.getState().available !== false) void refresh();
  }, 60_000);
  window.addEventListener('focus', () => void refresh());
  // Pushed immediately by the server after a pull.
  import.meta.hot?.on('lp:update', (status: UpdateStatus) => useUpdates.setState({ available: true, status }));
}

/** Which update the user has already acknowledged (lp:app:updates). */
export const useUpdatesSeen = createPersistedStore<{ seenSha: string; markSeen: (sha: string) => void }>(
  'app',
  'updates',
  (set) => ({ seenSha: '', markSeen: (sha) => set({ seenSha: sha }) }),
);

export const shortSha = (sha?: string) => (sha ? sha.slice(0, 7) : '—');
