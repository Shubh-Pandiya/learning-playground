import type { ComponentKind } from '../types';
import { GOVERN_INTERNALS } from './data/govern';
import { INGEST_INTERNALS } from './data/ingest';
import { PROCESS_INTERNALS } from './data/process';
import { STORAGE_INTERNALS } from './data/storage';
import type { Internals } from './types';

const ALL: Internals[] = [...INGEST_INTERNALS, ...PROCESS_INTERNALS, ...STORAGE_INTERNALS, ...GOVERN_INTERNALS];
const BY_KIND = new Map<ComponentKind, Internals>(ALL.map((i) => [i.kind, i]));

export const ALL_INTERNALS = ALL;
export const getInternals = (k: ComponentKind): Internals | undefined => BY_KIND.get(k);
