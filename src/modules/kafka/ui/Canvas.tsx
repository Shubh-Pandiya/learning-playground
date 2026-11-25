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
  type NodeChangeset,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@/shared/theme/theme';
import { cfgOf } from '../engine/defaults';
import { label, type Model } from '../engine/model';
import { partitionViews } from '../engine/tick';
import type { KGraph, KKind } from '../types';
import { EdgeMarkers, KEdgeView, type KFlowEdge } from './KEdgeView';
import { KNodeView, type KFlowNode } from './KNodeView';

export const DND_MIME = 'application/x-kafka-kind';

const nodeTypes = { k: KNodeView };
const edgeTypes = { k: KEdgeView };

export interface CanvasProps {
  g: KGraph;
  m: Model;
  t: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd?: (kind: KKind, x: number, y: number) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onConnect?: (from: string, to: string) => void;
  onRemove?: (nodeIds: string[], edgeIds: string[]) => void;
  fresh?: Set<string>;
  focus?: string;
  locked?: boolean;
  fitKey?: string | number;
  showRates?: boolean;
}

function Inner(p: CanvasProps) {
  const rf = useReactFlow();
  const dark = useTheme((s) => s.theme) === 'dark';
  const inited = useNodesInitialized();

  const derived = useMemo<KFlowNode[]>(
    () =>
      p.g.nodes.map((n) => {
        const issues = p.m.flags.filter((f) => f.nodeId === n.id && f.level !== 'info');
        return {
          id: n.id,
          type: 'k',
          position: { x: n.x, y: n.y },
          selected: p.selected === n.id,
          draggable: !p.locked,
          data: {
            kind: n.kind,
            label: label(n),
            cfg: cfgOf(n),
            view: p.m.view[n.id],
            parts: n.kind === 'topic' ? partitionViews(p.g, p.m, n.id, p.t, 12) : undefined,
            group: p.m.groups[n.id],
            issues: issues.length,
            bad: issues.some((f) => f.level === 'bad'),
            fresh: p.fresh?.has(n.id),
            dim: !!p.focus && p.focus !== n.id && !p.g.edges.some((e) => (e.from === p.focus && e.to === n.id) || (e.to === p.focus && e.from === n.id)),
          },
        };
      }),
    [p.g, p.m, p.t, p.selected, p.fresh, p.focus, p.locked],
  );

  // Local copy so React Flow can store measurements and in-progress drags.
  const [nodes, setNodes] = useState<KFlowNode[]>(derived);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return derived.map((n) => {
        const o = old.get(n.id);
        return o ? { ...n, measured: o.measured, width: o.width, height: o.height, position: o.dragging ? o.position : n.position, dragging: o.dragging } : n;
      });
    });
  }, [derived]);

  const edges = useMemo<KFlowEdge[]>(
    () =>
      p.g.edges.map((e) => {
        const v = p.m.edges[e.id];
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: 's',
          targetHandle: 't',
          type: 'k',
          selected: false,
          data: { kind: v?.kind ?? 'invalid', rate: v?.rate ?? 0, failing: !!v?.failing, animate: true, showRate: !!p.showRates, note: v?.note },
        };
      }),
    [p.g.edges, p.m.edges, p.showRates],
  );

  const onNodesChange = useCallback((changes: NodeChangeset<KFlowNode>) => {
    setNodes((ns) => changes.applyTo(ns));
  }, []);

  useEffect(() => {
    if (!inited) return;
    const h = setTimeout(() => rf.fitView({ padding: { top: '70px', bottom: '60px', left: '40px', right: '40px' }, duration: 350, maxZoom: 1.05 }), 40);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inited, p.fitKey]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData(DND_MIME) as KKind;
    if (!kind || !p.onAdd) return;
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    p.onAdd(kind, Math.round(pos.x - 75), Math.round(pos.y - 30));
  };

  return (
    <div className="relative h-full w-full" onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'))} onDrop={onDrop}>
      <EdgeMarkers />
      <ReactFlow<KFlowNode, KFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={(c: Connection) => c.source && c.target && c.source !== c.target && p.onConnect?.(c.source, c.target)}
        onNodeDragStop={(_, n) => p.onMove?.(n.id, Math.round(n.position.x), Math.round(n.position.y))}
        onPaneClick={() => p.onSelect(null)}
        onNodeClick={(_, n) => p.onSelect(n.id)}
        onNodesDelete={(ns) => p.onRemove?.(ns.map((n) => n.id), [])}
        onEdgesDelete={(es) => p.onRemove?.([], es.map((e) => e.id))}
        nodesConnectable={!p.locked && !!p.onConnect}
        deleteKeyCode={p.locked ? null : ['Backspace', 'Delete']}
        className={dark ? 'dark' : undefined}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
        defaultEdgeOptions={{ type: 'k' }}
        connectionLineStyle={{ stroke: 'rgb(var(--c-accent))', strokeWidth: 2 }}
      >
        <Background bgColor="transparent" variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgb(var(--c-faint) / 0.45)" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function Canvas(p: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...p} />
    </ReactFlowProvider>
  );
}
