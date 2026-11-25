import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/shared/ui';
import { KINDS } from '../data/components';
import { COL, graph, n } from '../data/lesson';
import { LESSONS } from '../data/lessons';
import { useKafka } from '../store';
import type { KGraph, KKind } from '../types';
import { PageBar } from '../ui/PageBar';
import { useLab } from '../ui/useLab';
import { Workbench } from '../ui/Workbench';

const ALL = Object.keys(KINDS) as KKind[];

export const STARTER: KGraph = graph(
  [n('service', 'svc', COL.a, 120, { rate: 2000 }, 'Order service'), n('topic', 'orders', COL.b + 40, 100, {}, 'orders'), n('group', 'billing', COL.c + 120, 120, {}, 'Billing consumers'), n('sink', 'db', COL.d + 140, 120, {}, 'Billing DB')],
  ['svc>orders', 'orders>billing', 'billing>db'],
);

const TEMPLATES: { id: string; label: string; g: KGraph }[] = [
  { id: 'starter', label: 'Starter pipeline', g: STARTER },
  { id: 'empty', label: 'Empty canvas', g: graph([], []) },
  ...LESSONS.map((l) => ({ id: l.id, label: `${l.n}. ${l.title} (finished design)`, g: l.build.reference })),
];

export function Lab() {
  const saved = useKafka((s) => s.canvases.lab);
  const save = useKafka((s) => s.saveCanvas);
  const visit = useKafka((s) => s.visit);
  const recordChaos = useKafka((s) => s.recordChaos);
  const lab = useLab(saved ?? STARTER, { onChange: (g) => save('lab', g) });
  useEffect(() => visit({ id: 'lab', mode: 'lab', path: '/kafka/lab', label: 'Kafka sandbox' }), [visit]);

  return (
    <div className="flex h-full flex-col">
      <PageBar eyebrow="Sandbox" title="Kafka lab: build anything, break anything">
        <select
          className="rounded-md border border-line bg-surface px-2 py-1 text-[12px]"
          value=""
          onChange={(e) => {
            const t = TEMPLATES.find((x) => x.id === e.target.value);
            if (t) {
              lab.reset(t.g);
              save('lab', t.g);
            }
          }}
        >
          <option value="">Load a template…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => (lab.reset(STARTER), save('lab', STARTER))}>
          Reset
        </Button>
      </PageBar>
      <div className="min-h-0 flex-1">
        <Workbench
          lab={lab}
          palette={ALL}
          onPredict={recordChaos}
          defaultTab="impact"
          left={
            <div>
              <div className="eyebrow">Free play</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                Every component you add and every config you change is re-simulated. The <b>Impact</b> tab tells you what changed, which metrics moved and why, and what the cluster did internally. Use <b>Chaos</b> to predict, then watch a failure play out.
              </p>
            </div>
          }
        />
      </div>
    </div>
  );
}
