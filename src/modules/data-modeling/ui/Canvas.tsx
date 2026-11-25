import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type NodeChangeset,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@/shared/theme/theme';
import type { Impact } from '../engine/analyze';
import type { Verdict } from '../engine/evaluate';
import type { DTable, ReadPattern, Scenario, Schema } from '../types';
import { RelEdge, RelMarkers, type DmFlowEdge } from './RelEdge';
import { CanvasCtx, MIME_TPL, TableNode, type CanvasActions, type DmFlowNode, type Flag } from './TableNode';

const FIT_PADDING = { top: '80px', bottom: '60px', left: '40px', right: '40px' } as const;
const nodeTypes: NodeTypes = { table: TableNode };
const edgeTypes: EdgeTypes = { rel: RelEdge };

export interface CanvasProps {
  sc: Scenario;
  schema: Schema;
  impact: Impact;
  verdicts?: Record<string, Verdict>;
  fresh?: string[];
  /** table id → columns that just changed */
  changed?: Record<string, string[]>;
  /** Access pattern id whose join path is highlighted. */
  focus?: string | null;
  editable: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onAddTable?: (tpl: string, x: number, y: number) => void;
  /** child → parent */
  onConnect?: (child: string, parent: string) => void;
  onDeleteTables?: (ids: string[]) => void;
  onDeleteRels?: (ids: string[]) => void;
  onTogglePk?: CanvasActions['onTogglePk'];
  onToggleIndex?: CanvasActions['onToggleIndex'];
  onRemoveCol?: CanvasActions['onRemoveCol'];
  onDropAttr?: CanvasActions['onDropAttr'];
  fitKey?: string;
}

const RANK: Record<Flag, number> = { info: 0, warn: 1, bad: 2 };

function handlesFor(a: DTable, b: DTable) {
  return b.x >= a.x + 120 ? { sourceHandle: 's-r', targetHandle: 't-l' } : b.x <= a.x - 120 ? { sourceHandle: 's-l', targetHandle: 't-r' } : { sourceHandle: 's-r', targetHandle: 't-r' };
}

function CanvasInner(p: CanvasProps) {
  const rf = useReactFlow();
  const theme = useTheme((s) => s.theme);
  const { impact, sc } = p;

  const focus = useMemo(() => {
    if (!p.focus) return null;
    const r = impact.reads[p.focus];
    const pat = sc.patterns.find((x) => x.id === p.focus) as ReadPattern | undefined;
    if (!r || !pat) return null;
    const relAttrs = impact.rels.filter((x) => r.tables.includes(x.parent) && r.tables.includes(x.child)).flatMap((x) => x.attrs);
    return { tables: new Set(r.tables), scans: new Set(r.scans), attrs: [...pat.attrs, ...(pat.by ?? []), ...(pat.sums ?? []), ...relAttrs] };
  }, [p.focus, impact, sc]);

  const built = useMemo<DmFlowNode[]>(() => {
    const fkOf = new Map<string, string[]>();
    for (const r of impact.rels) fkOf.set(r.child, [...(fkOf.get(r.child) ?? []), ...r.attrs]);
    return p.schema.tables.map((t) => {
      const flags: Record<string, Flag> = {};
      const issues = { bad: 0, warn: 0 };
      for (const i of impact.issues) {
        if (i.table !== t.id) continue;
        if (i.severity === 'bad') issues.bad++;
        else if (i.severity === 'warn') issues.warn++;
        for (const a of i.attrs ?? []) if (!flags[a] || RANK[i.severity] > RANK[flags[a]]) flags[a] = i.severity;
      }
      return {
        id: t.id,
        type: 'table' as const,
        position: { x: t.x, y: t.y },
        selected: t.id === p.selectedId,
        deletable: p.editable,
        data: {
          t,
          info: impact.tables[t.id],
          verdict: p.verdicts?.[t.id],
          fresh: p.fresh?.includes(t.id),
          flags,
          fks: fkOf.get(t.id) ?? [],
          issues,
          onPath: focus?.tables.has(t.id),
          scanned: focus?.scans.has(t.id),
          pathAttrs: focus?.tables.has(t.id) ? focus.attrs : undefined,
          changed: p.changed?.[t.id],
        },
      };
    });
  }, [p.schema, impact, p.verdicts, p.fresh, p.selectedId, p.editable, p.changed, focus]);

  const [nodes, setNodes] = useState<DmFlowNode[]>(built);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return built.map((n) => {
        const o = old.get(n.id);
        return o ? { ...o, ...n, measured: o.measured } : n;
      });
    });
  }, [built]);

  const edges = useMemo<DmFlowEdge[]>(() => {
    const byId = new Map(p.schema.tables.map((t) => [t.id, t]));
    return impact.rels.flatMap((r) => {
      const c = byId.get(r.child);
      const par = byId.get(r.parent);
      if (!c || !par) return [];
      return [
        {
          id: r.id,
          source: r.child,
          target: r.parent,
          type: 'rel' as const,
          deletable: p.editable,
          ...handlesFor(c, par),
          data: {
            card: r.card,
            identifying: r.identifying,
            label: r.attrs.map((a) => sc.attrs.find((x) => x.id === a)?.name ?? a).join(', '),
            onPath: !!focus && focus.tables.has(r.child) && focus.tables.has(r.parent),
          },
        },
      ];
    });
  }, [p.schema, impact.rels, p.editable, sc, focus]);

  const onNodesChange = useCallback((changes: NodeChangeset<DmFlowNode>) => setNodes((ns) => changes.applyTo(ns)), []);

  const inited = useNodesInitialized();
  useEffect(() => {
    if (!inited) return;
    const t = setTimeout(() => rf.fitView({ padding: FIT_PADDING, duration: 350, maxZoom: 1 }), 40);
    return () => clearTimeout(t);
  }, [p.fitKey, inited, rf]);

  const { onAddTable } = p;
  const onDrop = useCallback(
    (e: DragEvent) => {
      const tpl = e.dataTransfer.getData(MIME_TPL);
      if (!tpl || !onAddTable) return;
      e.preventDefault();
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onAddTable(tpl, Math.round(pos.x - 118), Math.round(pos.y - 30));
    },
    [rf, onAddTable],
  );

  const actions = useMemo<CanvasActions>(
    () => ({
      editable: p.editable,
      sc,
      attr: (id) => sc.attrs.find((a) => a.id === id),
      onTogglePk: p.onTogglePk,
      onToggleIndex: p.onToggleIndex,
      onRemoveCol: p.onRemoveCol,
      onDropAttr: p.onDropAttr,
    }),
    [p.editable, sc, p.onTogglePk, p.onToggleIndex, p.onRemoveCol, p.onDropAttr],
  );

  return (
    <CanvasCtx.Provider value={actions}>
      <div
        className="relative h-full w-full bg-sunken/60"
        onDragOver={(e) => {
          if (p.editable && e.dataTransfer.types.includes(MIME_TPL)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={onDrop}
      >
        <RelMarkers />
        <ReactFlow<DmFlowNode, DmFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          className={theme === 'dark' ? 'dark' : undefined}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_, n) => p.onMove?.(n.id, Math.round(n.position.x), Math.round(n.position.y))}
          onNodeClick={(_, n) => p.onSelect(n.id)}
          onPaneClick={() => p.onSelect(null)}
          onConnect={(c: Connection) => {
            if (c.source && c.target && c.source !== c.target) p.onConnect?.(c.source, c.target);
          }}
          onNodesDelete={(ns) => p.onDeleteTables?.(ns.map((n) => n.id))}
          onEdgesDelete={(es) => p.onDeleteRels?.(es.map((e) => e.id))}
          nodesConnectable={p.editable}
          nodesDraggable
          deleteKeyCode={p.editable ? ['Backspace', 'Delete'] : null}
          minZoom={0.25}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent' }}
        >
          <Background bgColor="transparent" variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgb(var(--c-faint) / 0.45)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
    </CanvasCtx.Provider>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
