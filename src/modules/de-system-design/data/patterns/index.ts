import type { Pattern } from '../../types';
import { BATCH_PATTERNS } from './batch';
import { INTERVIEW_PATTERNS } from './interview';
import { LAKEHOUSE_PATTERNS } from './lakehouse';
import { SERVING_PATTERNS } from './serving';
import { STREAMING_PATTERNS } from './streaming';
import { TRUST_PATTERNS } from './trust';

export const PATTERNS: Pattern[] = [
  ...BATCH_PATTERNS,
  ...LAKEHOUSE_PATTERNS,
  ...STREAMING_PATTERNS,
  ...SERVING_PATTERNS,
  ...TRUST_PATTERNS,
  ...INTERVIEW_PATTERNS,
].sort((a, b) => a.num - b.num);

const BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));
export const getPattern = (id: string | undefined): Pattern | undefined => (id ? BY_ID.get(id) : undefined);
