import type { ComponentKind } from '../types';
import { DATA_INTERNALS } from './data/data';
import { ENTRY_INTERNALS } from './data/entry';
import { LB } from './data/lb';
import { MESSAGING_INTERNALS } from './data/messaging';
import { STORAGE_INTERNALS } from './data/storage';
import type { Internals } from './types';

const ALL: Internals[] = [LB, ...ENTRY_INTERNALS, ...DATA_INTERNALS, ...STORAGE_INTERNALS, ...MESSAGING_INTERNALS];
const BY_KIND = new Map<ComponentKind, Internals>(ALL.map((i) => [i.kind, i]));

export const ALL_INTERNALS = ALL;
export const getInternals = (k: ComponentKind): Internals | undefined => BY_KIND.get(k);
