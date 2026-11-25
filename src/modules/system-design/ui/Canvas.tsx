import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from '@/shared/theme/theme';
import { edgeType, type SimResult } from '../engine/simulate';
import type { ComponentKind, GNode, Graph, Verdict } from '../types';
import { EdgeMarkers, FlowEdge, type SdFlowEdge } from './FlowEdge';
import { SdNode, type SdFlowNode } from './SdNode';

const FIT_PADDING = { top: '90px', bottom: '70px', left: '40px', right: '40px' } as const;

export const DND_MIME = 'application/x-sd-kind';

const nodeTypes: NodeTypes = { sd: SdNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };

export interface CanvasProps {
  graph: Graph;
  sim: SimResult;
  nodeVerdicts?: Record<string, Verdict>;
  edgeVerdicts?: Record<string, Verdict>;
  fresh?: string[];
  editable: boolean;
  animate: boolean;
  showRates?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onAddNode?: (kind: ComponentKind, x: number, y: number) => void;
  onConnect?: (from: string, to: string) => void;
  onDeleteNodes?: (ids: string[]) => void;
  onDeleteEdges?: (ids: string[]) => void;
  /** Re-fit the viewport whenever this changes. */
  fitKey?: string;
}

/** Pick handles from the relative position so vertical neighbours connect top/bottom. */
function handlesFor(a: GNode, b: GNode): { sourceHandle: string; targetHandle: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx > 90) return { sourceHandle: 's-r', targetHandle: 't-l' };
  if (Math.abs(dx) <= 90 && dy > 0) return { sourceHandle: 's-b', targetHandle: 't-t' };
  if (Math.abs(dx) <= 90 && dy < 0) return { sourceHandle: 's-t', targetHandle: 't-b' };
  return { sourceHandle: 's-r', targetHandle: 't-l' };
}

function CanvasInner(p: CanvasProps) {
  const rf = useReactFlow();
  const theme = useTheme((s) => s.theme);
  const wrap = useRef<HTMLDivElement>(null);

  const built = useMemo<SdFlowNode[]>(
    () =>
      p.graph.nodes.map((n) => ({
        id: n.id,
        type: 'sd',
        position: { x: n.x, y: n.y },
        selected: n.id === p.selectedId,
        deletable: p.editable,
        data: {
          kind: n.kind,
          label: n.label,
          count: n.count,
          down: n.down ?? 0,
          sim: p.sim.nodes[n.id],
          verdict: p.nodeVerdicts?.[n.id],
          fresh: p.fresh?.includes(n.id),
        },
      })),
    [p.graph.nodes, p.sim, p.nodeVerdicts, p.fresh, p.selectedId, p.editable],
  );

  // Local copy so React Flow can track drag positions and measured sizes between commits.
  const [nodes, setNodes] = useState<SdFlowNode[]>(built);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return built.map((n) => {
        const o = old.get(n.id);
        return o ? { ...o, ...n, measured: o.measured } : n;
      });
    });
  }, [built]);

  const edges = useMemo<SdFlowEdge[]>(() => {
    const byId = new Map(p.graph.nodes.map((n) => [n.id, n]));
    return p.graph.edges.flatMap((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return [];
      const es = p.sim.edges[e.id];
      return [
        {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'flow' as const,
          deletable: p.editable,
          ...handlesFor(a, b),
          data: {
            type: es?.type ?? edgeType(a, b),
            rate: es?.rate ?? 0,
            failing: !!es?.failing,
            verdict: p.edgeVerdicts?.[e.id],
            animate: p.animate,
            showRate: p.showRates,
          },
        },
      ];
    });
  }, [p.graph, p.sim, p.edgeVerdicts, p.animate, p.showRates, p.editable]);

  const onNodesChange = useCallback((changes: NodeChangeset<SdFlowNode>) => {
    setNodes((ns) => changes.applyTo(ns));
  }, []);

  const { onMove, onConnect: connect, onAddNode, onSelect } = p;

  // Refit once nodes are measured and whenever the caller's fitKey changes (leave room for the overlays).
  const inited = useNodesInitialized();
  useEffect(() => {
    if (!inited) return;
    const t = setTimeout(() => rf.fitView({ padding: FIT_PADDING, duration: 350, maxZoom: 1.1 }), 40);
    return () => clearTimeout(t);
  }, [p.fitKey, inited, rf]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      const kind = e.dataTransfer.getData(DND_MIME) as ComponentKind;
      if (!kind || !onAddNode) return;
      e.preventDefault();
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onAddNode(kind, Math.round(pos.x - 66), Math.round(pos.y - 50));
    },
    [rf, onAddNode],
  );

  return (
    <div
      ref={wrap}
      className="relative h-full w-full bg-sunken/60"
      onDragOver={(e) => {
        if (p.editable && e.dataTransfer.types.includes(DND_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
    >
      <EdgeMarkers />
      <ReactFlow<SdFlowNode, SdFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        className={theme === 'dark' ? 'dark' : undefined}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, n) => onMove?.(n.id, Math.round(n.position.x), Math.round(n.position.y))}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onConnect={(c: Connection) => {
          if (c.source && c.target && c.source !== c.target) connect?.(c.source, c.target);
        }}
        onNodesDelete={(ns) => p.onDeleteNodes?.(ns.map((n) => n.id))}
        onEdgesDelete={(es) => p.onDeleteEdges?.(es.map((e) => e.id))}
        nodesConnectable={p.editable}
        nodesDraggable
        deleteKeyCode={p.editable ? ['Backspace', 'Delete'] : null}
        minZoom={0.3}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background bgColor="transparent" variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgb(var(--c-faint) / 0.45)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
