import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, MousePointerClick, Server } from 'lucide-react';
import { cn } from '@/shared/cn';
import { headline } from '../engine/impact';
import type { KKind } from '../types';
import { Canvas } from './Canvas';
import { ChaosBar } from './ChaosBar';
import { ClusterView } from './ClusterView';
import { ImpactFeed, IssueList } from './Feed';
import { Inspector } from './Inspector';
import { MetricStrip } from './Metrics';
import { Palette } from './Palette';
import type { Lab } from './useLab';
import { useTick } from './useTick';

export interface ExtraTab {
  id: string;
  label: string;
  badge?: number;
  content: ReactNode;
}

export interface WorkbenchProps {
  lab: Lab;
  /** Top of the left column (scenario story, learn stepper…). */
  left?: ReactNode;
  palette?: KKind[];
  locked?: boolean;
  /** Chaos action ids to offer; `false` hides the chaos bar. */
  chaos?: string[] | false;
  onPredict?: (right: boolean) => void;
  fitKey?: string | number;
  focus?: string;
  /** Overlay in the canvas (e.g. a success banner). */
  overlay?: ReactNode;
  tabs?: ExtraTab[];
  defaultTab?: string;
  /** Hide the Red flags tab (incident drills, where it would give away the diagnosis). */
  hideIssues?: boolean;
  emptyHint?: ReactNode;
}

export function Workbench(p: WorkbenchProps) {
  const { lab } = p;
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(p.defaultTab ?? 'inspect');
  const [inside, setInside] = useState(false);
  const [topic, setTopic] = useState<string | undefined>();
  const [toast, setToast] = useState<string | null>(null);
  const t = useTick(true);
  const latest = lab.log[0];

  useEffect(() => {
    if (!latest) return;
    setToast(latest.id);
    const h = setTimeout(() => setToast(null), 5200);
    return () => clearTimeout(h);
  }, [latest]);

  useEffect(() => {
    if (selected && !lab.g.nodes.some((n) => n.id === selected)) setSelected(null);
  }, [lab.g, selected]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) {
      if (tab !== 'inspect' && !p.tabs?.some((x) => x.id === tab)) setTab('inspect');
      if (lab.g.nodes.find((n) => n.id === id)?.kind === 'topic') setTopic(id);
    }
  };

  const issues = lab.m.flags.filter((f) => f.level !== 'info');
  const tabs: ExtraTab[] = [
    ...(p.tabs ?? []),
    { id: 'inspect', label: selected ? 'Component' : 'Cluster', content: <Inspector lab={lab} selected={selected} locked={p.locked} /> },
    { id: 'impact', label: 'Impact', badge: lab.log.length, content: <ImpactFeed log={lab.log} onClear={lab.clearLog} /> },
    ...(p.hideIssues ? [] : [{ id: 'issues', label: 'Red flags', badge: issues.length, content: <IssueList flags={lab.m.flags} onPick={(id) => (setSelected(id), setTab('inspect'))} /> }]),
  ];
  const cur = tabs.find((x) => x.id === tab) ?? tabs[0];

  return (
    <div className="flex h-full min-h-0">
      {(p.left || p.palette) && (
        <aside className="flex w-[268px] shrink-0 flex-col overflow-y-auto border-r border-line bg-paper p-3.5">
          {p.left}
          {p.left && p.palette && <div className="my-3 h-px bg-line" />}
          {p.palette && (
            <Palette
              kinds={p.palette}
              onAdd={(k) => {
                const n = lab.g.nodes.length;
                const id = lab.add(k, 80 + (n % 4) * 230, 80 + Math.floor(n / 4) * 170);
                select(id);
              }}
            />
          )}
        </aside>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div className="bg-grid absolute inset-0 opacity-40" />
          <Canvas
            g={lab.g}
            m={lab.m}
            t={t}
            selected={selected}
            onSelect={select}
            onAdd={p.locked || !p.palette ? undefined : (k, x, y) => select(lab.add(k, x, y))}
            onMove={lab.move}
            onConnect={p.locked ? undefined : lab.connect}
            onRemove={p.locked ? undefined : lab.remove}
            fresh={lab.fresh}
            focus={p.focus}
            locked={p.locked}
            fitKey={p.fitKey}
            showRates
          />
          <div className="pointer-events-none absolute left-3 right-3 top-3">
            <div className="pointer-events-auto">
              <MetricStrip m={lab.m} />
            </div>
          </div>
          {!lab.g.nodes.length && p.emptyHint !== null && (
            <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center">
              <div className="rounded-xl border border-dashed border-line bg-surface/85 px-5 py-4 text-center">
                <MousePointerClick className="mx-auto mb-1 text-accent" size={20} />
                {p.emptyHint ?? (
                  <>
                    <p className="font-mono text-sm font-semibold">Drag components onto the canvas</p>
                    <p className="mt-1 text-[12px] text-muted">Start with a producer service, then a topic, then a consumer group. Every addition is explained on the right.</p>
                  </>
                )}
              </div>
            </div>
          )}
          {p.overlay}
          <AnimatePresence>
            {toast && latest && latest.id === toast && tab !== 'impact' && (
              <motion.button
                key={toast}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                onClick={() => setTab('impact')}
                className={cn(
                  'absolute right-3 top-[86px] z-10 max-w-[340px] rounded-xl border bg-surface px-3 py-2 text-left shadow-lift',
                  latest.verdict === 'better' ? 'border-ok/50' : latest.verdict === 'worse' ? 'border-bad/50' : 'border-line',
                )}
              >
                <div className={cn('eyebrow', latest.verdict === 'better' ? 'text-ok' : latest.verdict === 'worse' ? 'text-bad' : '')}>
                  {latest.verdict === 'better' ? 'Improved' : latest.verdict === 'worse' ? 'Got worse' : 'Changed'} · click for why
                </div>
                <div className="truncate text-[12.5px] font-medium">{latest.change}</div>
                <div className="line-clamp-2 text-[11.5px] text-muted">{headline(latest)}</div>
              </motion.button>
            )}
          </AnimatePresence>
          <div className="absolute bottom-3 left-3 right-[60px] z-10 space-y-2">
            {p.chaos !== false && <ChaosBar lab={lab} only={p.chaos} onPredict={p.onPredict} />}
          </div>
        </div>
        <div className={cn('shrink-0 border-t border-line bg-paper', inside ? 'h-[300px] overflow-y-auto' : '')}>
          <button onClick={() => setInside((x) => !x)} className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11.5px] font-medium text-muted hover:text-ink">
            <Server size={13} /> Inside the cluster: partitions, replicas, ISR, high watermark, committed offsets
            {inside ? <ChevronDown size={13} className="ml-auto" /> : <ChevronUp size={13} className="ml-auto" />}
          </button>
          {inside && <ClusterView g={lab.g} m={lab.m} t={t} topicId={topic} onTopic={setTopic} />}
        </div>
      </main>
      <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-paper">
        <div className="flex border-b border-line">
          {tabs.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={cn('flex-1 py-2 font-mono text-[10.5px] uppercase tracking-wider', cur.id === x.id ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
            >
              {x.label}
              {!!x.badge && <span className={cn('ml-1 rounded px-1 text-[10px]', x.id === 'issues' ? 'bg-bad/15 text-bad' : 'bg-sunken text-muted')}>{x.badge}</span>}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">{cur.content}</div>
      </aside>
    </div>
  );
}
