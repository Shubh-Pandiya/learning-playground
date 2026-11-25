import { ArrowLeft, Trash2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout } from '@/shared/ui';
import { fmtBytes, fmtNum, nfLabel, type Impact } from '../engine/analyze';
import { modelOf, type Verdict } from '../engine/evaluate';
import type { DTable, Scenario } from '../types';
import { IssueRow } from './ImpactPanel';
import { Rich } from './Rich';
import { KIND } from './TableNode';

const NF_EXPLAIN = [
  'Not even 1NF: no key that identifies a row, or a list stored in one column.',
  '1NF: atomic values and a key, but some columns depend on only part of the key.',
  '2NF: every column needs the whole key, but some depend on another non-key column.',
  '3NF: every non-key column depends on the key, the whole key, and nothing but the key.',
  'BCNF: every determinant is a candidate key. No redundancy from functional dependencies.',
];

export interface InspectorProps {
  sc: Scenario;
  table: DTable;
  impact: Impact;
  verdict?: Verdict;
  editable: boolean;
  onClose: () => void;
  onRemove: () => void;
}

export function Inspector({ sc, table, impact, verdict, editable, onClose, onRemove }: InspectorProps) {
  const info = impact.tables[table.id];
  const note = sc.notes[table.tpl];
  const name = (a: string) => sc.attrs.find((x) => x.id === a)?.name ?? a;
  const issues = impact.issues.filter((i) => i.table === table.id);
  const parents = impact.rels.filter((r) => r.child === table.id);
  const children = impact.rels.filter((r) => r.parent === table.id);
  const k = KIND[table.kind];
  const tone = note?.verdict === 'good' ? 'ok' : note?.verdict === 'wrong' || verdict === 'wrong' ? 'bad' : 'warn';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Back">
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-faint">{k.label}</div>
          <div className="truncate font-mono text-[14px] font-semibold text-ink">{table.name}</div>
        </div>
        {editable && (
          <Button size="xs" variant="danger" icon={<Trash2 size={12} />} onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {note && (
          <Callout tone={tone} title={note.title}>
            <Rich text={note.body} />
            {note.tradeoffs && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {note.tradeoffs.map((t, i) => (
                  <li key={i}>
                    <Rich text={t} />
                  </li>
                ))}
              </ul>
            )}
            {note.instead && (
              <p className="mt-1.5 font-medium">
                Instead: <Rich text={note.instead} />
              </p>
            )}
          </Callout>
        )}

        {info && (
          <div className="grid grid-cols-3 gap-1.5">
            {[
              ['rows', fmtNum(info.rows)],
              ['row size', `${info.rowBytes} B`],
              ['size', fmtBytes(info.bytes)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-line bg-surface px-2 py-1">
                <div className="font-mono text-[9px] uppercase tracking-wider text-faint">{l}</div>
                <div className="font-mono text-[13px] font-semibold text-ink">{v}</div>
              </div>
            ))}
          </div>
        )}

        {info && (
          <section>
            <div className="eyebrow mb-1">Key and grain</div>
            <p className="text-[12.5px] leading-snug text-ink">
              {info.pk.length ? (
                <>
                  Primary key <code className="rounded bg-sunken px-1 font-mono text-[11.5px]">({info.pk.map(name).join(', ')})</code>: one row per{' '}
                  {modelGrain(sc, info.pk)}.
                </>
              ) : (
                <span className="text-bad">No primary key. Click the key icon on the column(s) that identify a row.</span>
              )}
            </p>
            {info.undetermined.length > 0 && (
              <p className="mt-1 text-[12px] leading-snug text-bad">The key doesn't determine {info.undetermined.map(name).join(', ')}: two rows could share the key with different values.</p>
            )}
          </section>
        )}

        {info && (
          <section>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="eyebrow">Normal form</span>
              <span className={cn('font-mono text-[12px] font-semibold', info.byDesign ? 'text-info' : info.nf >= 3 ? 'text-ok' : info.nf >= 2 ? 'text-warn' : 'text-bad')}>{nfLabel(info)}</span>
            </div>
            <p className="text-[12px] leading-snug text-muted">{NF_EXPLAIN[info.pk.length ? info.nf : 0]}</p>
            {info.byDesign && <p className="mt-1 text-[12px] leading-snug text-info">A {k.label} is denormalised on purpose: redundancy is the price of fewer joins, so these findings are informational.</p>}
            {info.violations.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {info.violations.map((v, i) => (
                  <li key={i} className="rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] text-ink">
                    <span className="text-faint">{v.kind}:</span> {v.lhs.map(name).join(', ')} → {v.rhs.map(name).join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {info && info.anomalies.length > 0 && !info.byDesign && (
          <section>
            <div className="eyebrow mb-1">Write anomalies</div>
            <ul className="space-y-1">
              {info.anomalies.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-muted">
                  <span className={cn('mt-0.5 shrink-0 rounded px-1 font-mono text-[9.5px] font-semibold uppercase', a.kind === 'update' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>{a.kind}</span>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(parents.length > 0 || children.length > 0) && (
          <section>
            <div className="eyebrow mb-1">Relationships</div>
            <ul className="space-y-0.5 font-mono text-[11.5px] text-muted">
              {parents.map((r) => (
                <li key={r.id}>
                  → {impact.tables[r.parent]?.name} <span className="text-faint">via {r.attrs.map(name).join(', ')} ({r.card === '1:1' ? '1:1' : 'many-to-one'}{r.identifying ? ', identifying' : ''})</span>
                </li>
              ))}
              {children.map((r) => (
                <li key={r.id}>
                  ← {impact.tables[r.child]?.name} <span className="text-faint">references this ({r.card === '1:1' ? '1:1' : 'one-to-many'})</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {issues.length > 0 && (
          <section>
            <div className="eyebrow mb-1">Red flags on this table</div>
            <ul className="space-y-1.5">
              {issues.map((i) => (
                <IssueRow key={i.key} i={i} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function modelGrain(sc: Scenario, pk: string[]): string {
  const label = modelOf(sc).grainLabel(pk);
  return label ? `${label.replace(/(ie)?s$/, (_, ie) => (ie ? 'y' : ''))}` : pk.map((a) => sc.attrs.find((x) => x.id === a)?.name ?? a).join(' + ');
}
