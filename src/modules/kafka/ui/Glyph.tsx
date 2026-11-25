import { Database, FileCheck2, HardDrive, Inbox, MemoryStick, Rows3, ScrollText, Send, Timer, Users, Workflow, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/cn';
import { KINDS } from '../data/components';
import type { KKind, Tone } from '../types';

const ICONS: Record<string, LucideIcon> = { Send, Database, ScrollText, Rows3, Users, Workflow, HardDrive, FileCheck2, Timer, MemoryStick, Inbox };

export const TONE_RGB: Record<Tone, string> = {
  green: '22 163 74',
  blue: '37 99 235',
  violet: '124 58 237',
  orange: '234 88 12',
  rose: '225 29 72',
  teal: '13 148 136',
  sand: '161 98 7',
  slate: '71 85 105',
  yellow: '202 138 4',
};

export function Glyph({ kind, size = 34, dim, className }: { kind: KKind; size?: number; dim?: boolean; className?: string }) {
  const def = KINDS[kind];
  const Icon = ICONS[def.icon] ?? Rows3;
  const rgb = TONE_RGB[def.tone];
  const trap = def.category === 'trap';
  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center rounded-lg border', def.shape === 'hex' && 'rounded-xl', def.shape === 'cylinder' && 'rounded-[40%/22%]', dim && 'opacity-40 grayscale', className)}
      style={{ width: size, height: size, background: `rgb(${rgb} / 0.12)`, borderColor: `rgb(${rgb} / 0.35)`, color: `rgb(${rgb})` }}
    >
      <Icon size={Math.round(size * 0.52)} strokeWidth={1.9} />
      {trap && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-bad" />}
    </span>
  );
}
