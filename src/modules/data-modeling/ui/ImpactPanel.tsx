import { useState } from 'react';
import { ChevronDown, Crosshair, Search, Zap } from 'lucide-react';
import { cn } from '@/shared/cn';
import { fmtBytes, fmtNum, nfLabel, type Impact, type Issue, type Level } from '../engine/analyze';
import type { Scenario } from '../types';

const DOT: Record<Level, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' };
const SEV = { bad: 'border-bad/35 bg-bad/[0.06]', warn: 'border-warn/35 bg-warn/[0.07]', info: 'border-line bg-surface' } as const;
const SEV_TXT = { bad: 'text-bad', warn: 'text-warn', info: 'text-info' } as const;

function Section({ title, count, children, open: init = true }: { title: string; count?: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(init);
  return (
    <section>
      <button onClick={() => setOpen((v) => !v)} className="mb-1.5 flex w-full items-center gap-1 text-left">
        <ChevronDown size={13} className={cn('text-faint transition-transform', !open && '-rotate-90')} />
        <span className="eyebrow flex-1">{title}</span>
        {count && <span className="font-mono text-[10.5px] text-faint">{count}</span>}
      </button>
      {open && children}
    </section>
  );
}

export interface ImpactPanelProps {
  sc: Scenario;
  impact: Impact;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onSelectTable: (id: string) => void;
}

/** Live "what this model costs" panel: every access pattern, write, table and red flag. */
export function ImpactPanel({ sc, impact, focus, onFocus, onSelectTable }: ImpactPanelProps) {
  const name = (id: string) => impact.tables[id]?.name ?? id;
  const issues = [...impact.issues].sort((a, b) => ['bad', 'warn', 'info'].indexOf(a.severity) - ['bad', 'warn', 'info'].indexOf(b.severity));
  const reads = sc.patterns.filter((p) => p.kind === 'read').map((p) => impact.reads[p.id]);
  const writes = sc.patterns.filter((p) => p.kind === 'write').map((p) => impact.writes[p.id]);
  const serious = issues.filter((i) => i.severity !== 'info');

  return (
    <div className="space-y-4">
      <Section title="Queries (reads)" count={`${reads.filter((r) => r.level === 'ok').length}/${reads.length} ok`}>
        <p className="mb-1.5 text-[11px] leading-snug text-faint">Click one to trace its join path on the canvas.</p>
        <ul className="space-y-1">
          {reads.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onFocus(focus === r.id ? null : r.id)}
                className={cn('w-full rounded-lg border px-2 py-1.5 text-left transition', focus === r.id ? 'border-accent bg-accent/[0.07]' : 'border-line bg-surface hover:border-accent/50')}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[r.level])} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{r.name}</span>
                  {focus === r.id && <Crosshair size={12} className="text-accent" />}
                  <span className="font-mono text-[10px] text-faint">{r.perSec >= 1 ? `${fmtNum(r.perSec)}/s` : r.perSec >= 1 / 60 ? `${fmtNum(r.perSec * 60)}/min` : r.perSec >= 1 / 3600 ? `${fmtNum(r.perSec * 3600)}/h` : 'daily'}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 pl-3.5 font-mono text-[10.5px] text-muted">
                  {r.missing.length ? (
                    <span className="text-bad">can't answer: {r.missing.length} attr{r.missing.length > 1 ? 's' : ''} not stored</span>
                  ) : !r.tables.length ? (
                    <span className="text-bad">no join path</span>
                  ) : (
                    <>
                      <span className={r.joins > r.maxJoins ? 'text-bad' : undefined}>
                        {r.joins} join{r.joins === 1 ? '' : 's'} / budget {r.maxJoins}
                      </span>
                      <span className={cn('inline-flex items-center gap-0.5', r.access === 'scan' ? 'text-warn' : 'text-ok')}>
                        {r.access === 'scan' ? <Zap size={10} /> : <Search size={10} />}
                        {r.access}
                      </span>
                      <span>~{fmtNum(r.rowsRead)} rows</span>
                    </>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {writes.length > 0 && (
        <Section title="Writes (one logical change)" count={`${writes.filter((w) => w.level === 'ok').length}/${writes.length} ok`}>
          <ul className="space-y-1">
            {writes.map((w) => (
              <li key={w.id} className="rounded-lg border border-line bg-surface px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[w.level])} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{w.name}</span>
                  <span className={cn('font-mono text-[11px] font-semibold', w.rows <= 1 ? 'text-ok' : w.rows <= 100 ? 'text-warn' : 'text-bad')}>
                    {fmtNum(w.rows)} row{w.rows === 1 ? '' : 's'}
                  </span>
                </div>
                {w.perTable.length > 0 && (
                  <div className="mt-0.5 pl-3.5 font-mono text-[10.5px] text-muted">{w.perTable.map((p) => `${name(p.table)} ×${fmtNum(p.rows)}`).join(' · ')}</div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Red flags" count={serious.length ? `${impact.counts.bad}✗ ${impact.counts.warn}⚠` : 'none'}>
        {issues.length === 0 && <p className="text-[12px] text-ok">No problems found in this model.</p>}
        <ul className="space-y-1.5">
          {issues.map((i) => (
            <IssueRow key={i.key} i={i} onClick={i.table ? () => onSelectTable(i.table!) : i.pattern ? () => onFocus(i.pattern!) : undefined} />
          ))}
        </ul>
      </Section>

      <Section title="Tables" count={fmtBytes(impact.storage)} open={false}>
        <table className="w-full font-mono text-[10.5px]">
          <thead className="text-faint">
            <tr className="text-left">
              <th className="font-normal">table</th>
              <th className="font-normal">NF</th>
              <th className="text-right font-normal">rows</th>
              <th className="text-right font-normal">size</th>
              <th className="text-right font-normal">anom.</th>
            </tr>
          </thead>
          <tbody>
            {impact.order.map((id) => {
              const t = impact.tables[id];
              return (
                <tr key={id} onClick={() => onSelectTable(id)} className="cursor-pointer border-t border-line/60 hover:bg-sunken">
                  <td className="max-w-[110px] truncate py-0.5 text-ink">{t.name}</td>
                  <td className={t.byDesign ? 'text-info' : t.nf >= 3 ? 'text-ok' : t.nf >= 2 ? 'text-warn' : 'text-bad'}>{t.byDesign ? 'denorm' : nfLabel(t)}</td>
                  <td className="text-right text-muted">{fmtNum(t.rows)}</td>
                  <td className="text-right text-muted">{fmtBytes(t.bytes)}</td>
                  <td className={cn('text-right', !t.byDesign && t.anomalies.length ? 'text-bad' : 'text-faint')}>{t.byDesign ? '—' : t.anomalies.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {impact.duplicated.length > 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-muted">
            Duplicated: {impact.duplicated.map((d) => sc.attrs.find((a) => a.id === d.attr)?.name ?? d.attr).join(', ')} ({fmtBytes(impact.dupBytes)} of copies to keep in sync).
          </p>
        )}
        {impact.unplaced.length > 0 && (
          <p className="mt-1 text-[11px] leading-snug text-bad">Not stored anywhere: {impact.unplaced.map((a) => sc.attrs.find((x) => x.id === a)?.name ?? a).join(', ')}.</p>
        )}
      </Section>
    </div>
  );
}

export function IssueRow({ i, onClick }: { i: Issue; onClick?: () => void }) {
  return (
    <li>
      <div role={onClick ? 'button' : undefined} onClick={onClick} className={cn('rounded-lg border px-2 py-1.5', SEV[i.severity], onClick && 'cursor-pointer')}>
        <div className={cn('text-[12px] font-semibold leading-snug', SEV_TXT[i.severity])}>
          {i.severity === 'bad' ? '✗ ' : i.severity === 'warn' ? '⚠ ' : 'ⓘ '}
          {i.title}
        </div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{i.detail}</p>
        {i.fix && i.severity !== 'info' && <p className="mt-0.5 text-[11.5px] leading-snug text-ink">→ {i.fix}</p>}
      </div>
    </li>
  );
}
