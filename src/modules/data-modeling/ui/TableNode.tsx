import { createContext, memo, useContext, useState, type DragEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import { GripVertical, Key, Link2, ListOrdered, X, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tooltip } from '@/shared/ui';
import { fmtBytes, fmtNum, nfLabel, type TableInfo } from '../engine/analyze';
import type { Attr, DTable, Scenario, TableKind } from '../types';

export const MIME_TPL = 'application/x-dm-tpl';
export const MIME_ATTR = 'application/x-dm-attr';
export const MIME_COL = 'application/x-dm-col';

export interface CanvasActions {
  editable: boolean;
  sc: Scenario;
  attr: (id: string) => Attr | undefined;
  onTogglePk?: (table: string, attr: string) => void;
  onToggleIndex?: (table: string, attr: string) => void;
  onRemoveCol?: (table: string, attr: string) => void;
  /** from = source table id (column drag) or undefined (attribute pool). */
  onDropAttr?: (to: string, attr: string, from: string | undefined, copy: boolean) => void;
}

export const CanvasCtx = createContext<CanvasActions | null>(null);

export type Flag = 'bad' | 'warn' | 'info';

export interface TableNodeData extends Record<string, unknown> {
  t: DTable;
  info?: TableInfo;
  verdict?: 'good' | 'wrong' | 'extra';
  fresh?: boolean;
  /** Column → worst flag on it. */
  flags: Record<string, Flag>;
  /** Columns that are foreign keys (hold another table's PK). */
  fks: string[];
  issues: { bad: number; warn: number };
  /** On the highlighted access pattern's path. */
  onPath?: boolean;
  scanned?: boolean;
  pathAttrs?: string[];
  /** Columns just added/changed. */
  changed?: string[];
}

export type DmFlowNode = Node<TableNodeData, 'table'>;

export const KIND: Record<TableKind, { label: string; tone: string }> = {
  entity: { label: 'entity', tone: 'bg-accent' },
  bridge: { label: 'bridge N:M', tone: 'bg-accent' },
  lookup: { label: 'lookup', tone: 'bg-faint' },
  flat: { label: 'flat', tone: 'bg-warn' },
  fact: { label: 'fact', tone: 'bg-violet' },
  snapshot: { label: 'snapshot fact', tone: 'bg-violet' },
  factless: { label: 'factless fact', tone: 'bg-violet' },
  dim: { label: 'dimension', tone: 'bg-info' },
  junk: { label: 'junk dim', tone: 'bg-info' },
  obt: { label: 'one big table', tone: 'bg-warn' },
  aggregate: { label: 'aggregate', tone: 'bg-ok' },
  hub: { label: 'hub', tone: 'bg-accent' },
  link: { label: 'link', tone: 'bg-violet' },
  sat: { label: 'satellite', tone: 'bg-info' },
  event: { label: 'event log', tone: 'bg-violet' },
  feed: { label: 'read model', tone: 'bg-ok' },
};

const NF_TONE = (info: TableInfo) => {
  if (!info.pk.length || info.nf === 0) return info.byDesign ? 'border-warn/40 text-warn' : 'border-bad/50 bg-bad/10 text-bad';
  if (info.byDesign || info.kind === 'fact' || info.kind === 'snapshot' || info.kind === 'event' || info.kind === 'factless') return 'border-line text-muted';
  if (info.nf >= 3) return 'border-ok/40 bg-ok/10 text-ok';
  return 'border-warn/50 bg-warn/10 text-warn';
};

const FLAG_ROW: Record<Flag, string> = {
  bad: 'bg-bad/10',
  warn: 'bg-warn/10',
  info: '',
};

const handleCls = '!h-2.5 !w-2.5 !rounded-full !border-2 !border-surface !bg-faint';
const hidden = '!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 !pointer-events-none';

function ColumnRow({
  tableId,
  attr,
  pk,
  indexed,
  fk,
  flag,
  onPath,
  changed,
}: {
  tableId: string;
  attr: string;
  pk?: boolean;
  indexed?: boolean;
  fk: boolean;
  flag?: Flag;
  onPath?: boolean;
  changed?: boolean;
}) {
  const ctx = useContext(CanvasCtx)!;
  const a = ctx.attr(attr);
  const ed = ctx.editable;
  const start = (e: DragEvent) => {
    e.dataTransfer.setData(MIME_COL, JSON.stringify({ attr, from: tableId, pk: !!pk }));
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  return (
    <motion.div
      layout="position"
      className="rounded"
      initial={changed ? { backgroundColor: 'rgb(var(--c-accent) / 0.3)' } : false}
      animate={{ backgroundColor: 'rgb(var(--c-accent) / 0)' }}
      transition={{ duration: 1.8 }}
    >
      <div
        draggable={ed}
        onDragStart={start}
        className={cn(
          'nodrag group/col flex h-[22px] items-center gap-1 rounded px-1 font-mono text-[11px]',
          flag && FLAG_ROW[flag],
          onPath && 'outline outline-1 outline-accent/50',
          ed && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {ed && <GripVertical size={10} className="-ml-0.5 shrink-0 text-faint/60 opacity-0 group-hover/col:opacity-100" />}
        <Tooltip content={pk ? 'Primary key (click to toggle)' : 'Make part of the primary key'}>
          <button
            disabled={!ed}
            onClick={() => ctx.onTogglePk?.(tableId, attr)}
            className={cn('shrink-0', pk ? 'text-warn' : 'text-faint/40 hover:text-faint', !ed && 'cursor-default')}
            aria-label="Toggle primary key"
          >
            <Key size={11} />
          </button>
        </Tooltip>
        <span
          className={cn('min-w-0 flex-1 truncate', pk ? 'font-semibold text-ink' : 'text-ink/90', a?.technical && 'italic text-violet', flag === 'bad' && 'text-bad', flag === 'warn' && 'text-warn')}
          title={a?.doc}
        >
          {a?.name ?? attr}
        </span>
        {fk && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-sunken px-0.5 text-[9px] text-muted" title="Foreign key: holds another table's primary key">
            <Link2 size={9} />
            FK
          </span>
        )}
        <span className="shrink-0 text-[9.5px] text-faint">{a?.multi ? 'list' : a?.type}</span>
        <Tooltip content={indexed ? 'Indexed (click to drop the index)' : pk ? 'The PK is indexed' : 'Add an index on this column'}>
          <button
            disabled={!ed || pk}
            onClick={() => ctx.onToggleIndex?.(tableId, attr)}
            className={cn('shrink-0', indexed ? 'text-info' : 'text-faint/30 hover:text-faint', (pk || (!ed && !indexed)) && 'invisible', !ed && 'cursor-default')}
            aria-label="Toggle index"
          >
            <ListOrdered size={11} />
          </button>
        </Tooltip>
        {ed && (
          <button onClick={() => ctx.onRemoveCol?.(tableId, attr)} className="shrink-0 text-faint/0 hover:text-bad group-hover/col:text-faint" aria-label="Remove column">
            <X size={11} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function TableNodeView({ id, data, selected }: NodeProps<DmFlowNode>) {
  const ctx = useContext(CanvasCtx)!;
  const { t, info } = data;
  const [over, setOver] = useState(false);
  const k = KIND[t.kind];
  const wrong = data.verdict === 'wrong';
  const accepts = (e: DragEvent) => ctx.editable && (e.dataTransfer.types.includes(MIME_ATTR) || e.dataTransfer.types.includes(MIME_COL));

  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const col = e.dataTransfer.getData(MIME_COL);
    if (col) {
      const c = JSON.parse(col) as { attr: string; from: string; pk: boolean };
      if (c.from === id) return;
      // keys are copied (that is what a foreign key is); other columns move unless Alt/Shift is held
      ctx.onDropAttr?.(id, c.attr, c.from, c.pk || e.altKey || e.shiftKey);
      return;
    }
    const a = e.dataTransfer.getData(MIME_ATTR);
    if (a) ctx.onDropAttr?.(id, a, undefined, true);
  };

  const pkCols = t.columns.filter((c) => c.pk);
  const rest = t.columns.filter((c) => !c.pk);

  return (
    <div
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MIME_ATTR) ? 'copy' : 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'relative w-[236px] rounded-xl border bg-surface/95 shadow-paper transition-shadow',
        wrong ? 'border-bad bg-bad/[0.05]' : data.verdict === 'extra' ? 'border-warn/60' : 'border-line',
        data.onPath && 'ring-2 ring-accent/70',
        data.scanned && 'ring-2 ring-bad/80',
        selected && 'outline outline-2 outline-offset-2 outline-accent',
        over && 'ring-2 ring-accent shadow-[0_0_0_6px_rgb(var(--c-accent)/0.18)]',
        data.fresh && 'animate-pulse-soft shadow-[0_0_0_6px_rgb(var(--c-accent)/0.18)]',
      )}
    >
      <Handle type="target" position={Position.Left} id="t-l" className={handleCls} />
      <Handle type="target" position={Position.Right} id="t-r" className={hidden} />
      <Handle type="source" position={Position.Right} id="s-r" className={cn(handleCls, '!bg-accent')} />
      <Handle type="source" position={Position.Left} id="s-l" className={hidden} />

      {wrong && <span className="absolute -left-2 -top-2 z-10 whitespace-nowrap rounded-full bg-bad px-1.5 font-mono text-[10px] font-bold text-paper">✗ wrong choice</span>}
      {data.verdict === 'extra' && <span className="absolute -left-2 -top-2 z-10 whitespace-nowrap rounded-full bg-warn px-1.5 font-mono text-[10px] font-bold text-paper">not needed?</span>}
      {data.scanned && (
        <span className="absolute -right-2 -top-2 z-10 flex items-center gap-0.5 whitespace-nowrap rounded-full bg-bad px-1.5 font-mono text-[10px] font-bold text-paper">
          <Zap size={10} /> full scan
        </span>
      )}

      <div className={cn('h-1 rounded-t-xl', k.tone)} />
      <div className="flex items-start gap-2 px-2.5 pb-1 pt-1.5">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9px] uppercase tracking-wider text-faint">{k.label}</div>
          <div className="truncate font-mono text-[13px] font-semibold leading-tight text-ink">{t.name}</div>
        </div>
        {info && (
          <span className={cn('mt-0.5 shrink-0 rounded border px-1 font-mono text-[10px] font-semibold', NF_TONE(info))} title="Normal form reached">
            {info.byDesign && info.pk.length && info.nf > 0 ? 'denorm' : nfLabel(info)}
          </span>
        )}
      </div>
      <div className="px-1.5 pb-1">
        {pkCols.map((c) => (
          <ColumnRow
            key={c.attr}
            tableId={id}
            attr={c.attr}
            pk
            indexed={c.indexed}
            fk={data.fks.includes(c.attr)}
            flag={data.flags[c.attr]}
            onPath={data.pathAttrs?.includes(c.attr)}
            changed={data.changed?.includes(c.attr)}
          />
        ))}
        {pkCols.length > 0 && rest.length > 0 && <div className="mx-1 my-0.5 h-px bg-line" />}
        {rest.map((c) => (
          <ColumnRow
            key={c.attr}
            tableId={id}
            attr={c.attr}
            indexed={c.indexed}
            fk={data.fks.includes(c.attr)}
            flag={data.flags[c.attr]}
            onPath={data.pathAttrs?.includes(c.attr)}
            changed={data.changed?.includes(c.attr)}
          />
        ))}
        {!t.columns.length && <div className="px-1 py-2 text-center font-mono text-[10.5px] text-faint">drop attributes here</div>}
      </div>
      {info && (
        <div className="flex items-center gap-2 border-t border-line px-2.5 py-1 font-mono text-[10px] text-faint">
          <span title="Estimated rows">{fmtNum(info.rows)} rows</span>
          <span title="Estimated heap size">{fmtBytes(info.bytes)}</span>
          <span className="flex-1" />
          {data.issues.bad > 0 && <span className="font-semibold text-bad">✗ {data.issues.bad}</span>}
          {data.issues.warn > 0 && <span className="font-semibold text-warn">⚠ {data.issues.warn}</span>}
          {!data.issues.bad && !data.issues.warn && <span className="text-ok">✓</span>}
        </div>
      )}
    </div>
  );
}

export const TableNode = memo(TableNodeView);
