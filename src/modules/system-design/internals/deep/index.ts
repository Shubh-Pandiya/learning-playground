import { useEffect, useState } from 'react';
import type { ComponentKind } from '../../types';
import type { Deep } from '../types';

/** One file per component kind (`./data/<kind>.ts`, default export), lazy-loaded so the depth content stays out of the main bundle. */
const MODS = import.meta.glob<{ default: Deep }>('./data/*.ts');
const PATH = (k: ComponentKind) => `./data/${k}.ts`;

export const hasDeep = (k: ComponentKind) => PATH(k) in MODS;
export const DEEP_KINDS = Object.keys(MODS).map((p) => p.slice(7, -3) as ComponentKind);

const cache = new Map<ComponentKind, Deep>();
export async function loadDeep(k: ComponentKind): Promise<Deep | undefined> {
  if (cache.has(k)) return cache.get(k);
  const load = MODS[PATH(k)];
  if (!load) return undefined;
  const d = (await load()).default;
  cache.set(k, d);
  return d;
}

/** `undefined` while loading, `null` when the kind has no deep content. */
export function useDeep(k: ComponentKind): Deep | null | undefined {
  const [d, setD] = useState<Deep | null | undefined>(() => (hasDeep(k) ? cache.get(k) : null));
  useEffect(() => {
    let live = true;
    if (!hasDeep(k)) return setD(null);
    setD(cache.get(k));
    loadDeep(k).then((x) => live && setD(x ?? null));
    return () => {
      live = false;
    };
  }, [k]);
  return d;
}
