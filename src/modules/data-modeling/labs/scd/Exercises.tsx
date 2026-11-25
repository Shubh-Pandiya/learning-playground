import { useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout } from '@/shared/ui';
import { ChangeCard, type Change } from '../../ui/ChangeCard';
import { Rich } from '../../ui/Rich';
import { ASWAS_QS, LATE_DIM, LATE_FACTS, PICK_CARDS, SCD_TYPES, TYPE_INFO, type ScdType } from './data';
import { fmtK } from './engine';

const WRONG: Record<ScdType, string> = {
  0: 'ignores every change',
  1: 'overwrites and destroys history',
  2: 'adds a full row per change',
  3: 'keeps only one previous value, without dates',
  4: 'splits current and history into separate tables',
  6: 'stores versions plus current columns (most storage and ETL work)',
};

function TypeChips({ value, onPick, disabled }: { value: ScdType | undefined; onPick: (t: ScdType) => void; disabled?: boolean }) {
  return (
    <div className="mt-1.5 flex gap-1">
      {SCD_TYPES.map((t) => (
        <button
          key={t}
          disabled={disabled}
          onClick={() => onPick(t)}
          className={cn(
            'h-6 flex-1 rounded border font-mono text-[11px] transition',
            value === t ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:border-accent hover:text-ink',
          )}
        >
          T{t}
        </button>
      ))}
    </div>
  );
}

function Shell({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className={cn('rounded-xl border bg-surface p-3', done ? 'border-ok/50' : 'border-line')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-mono text-[12.5px] font-semibold text-ink">{title}</h3>
        {done && <span className="font-mono text-[10.5px] text-ok">✓ solved</span>}
      </div>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

/** Generic "choose a type per card, check all at once" exercise. */
function TypeMatcher({
  items,
  done,
  onSolved,
  label,
}: {
  items: { id: string; text: string; answer: ScdType; why: string }[];
  done?: boolean;
  onSolved: () => void;
  label: string;
}) {
  const [picks, setPicks] = useState<Record<string, ScdType>>({});
  const [checked, setChecked] = useState<Record<string, boolean | undefined> | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const check = () => {
    const res: Record<string, boolean | undefined> = {};
    for (const it of items) res[it.id] = picks[it.id] === it.answer;
    setChecked(res);
    const right = items.filter((it) => res[it.id]).length;
    const missing = items.filter((it) => picks[it.id] === undefined).length;
    setChange({
      key: `${label}-${Date.now()}`,
      title: `Checked ${label}: **${right}/${items.length}** right`,
      lines: [
        right === items.length
          ? { tone: 'ok', text: 'All correct in one run: exercise solved.' }
          : { tone: 'bad', text: `${items.length - right} wrong${missing ? ` (${missing} unanswered)` : ''}. Red cards explain why; fix them and check again.` },
      ],
    });
    if (right === items.length) onSolved();
  };
  return (
    <>
      {items.map((it) => {
        const res = checked?.[it.id];
        const p = picks[it.id];
        return (
          <div key={it.id} className={cn('rounded-lg border p-2', res === undefined ? 'border-line' : res ? 'border-ok/50 bg-ok/[0.05]' : 'border-bad/50 bg-bad/[0.05]')}>
            <p className="text-[12.5px] leading-snug text-ink">
              <Rich text={it.text} />
            </p>
            <TypeChips
              value={p}
              onPick={(t) => {
                setPicks((x) => ({ ...x, [it.id]: t }));
                setChecked((c) => (c ? { ...c, [it.id]: undefined } : c));
              }}
            />
            {res === false && p !== undefined && (
              <p className="mt-1.5 text-[11.5px] leading-snug text-bad">
                ✗ Type {p} {WRONG[p]}. <span className="text-muted">Use Type {it.answer} ({TYPE_INFO[it.answer].short}): <Rich text={it.why} /></span>
              </p>
            )}
            {res === false && p === undefined && <p className="mt-1.5 text-[11.5px] text-bad">✗ Not answered.</p>}
            {res === true && (
              <p className="mt-1.5 text-[11.5px] leading-snug text-ok">
                ✓ <span className="text-muted"><Rich text={it.why} /></span>
              </p>
            )}
          </div>
        );
      })}
      <Button size="sm" variant={done ? 'success' : 'primary'} onClick={check}>
        Check all
      </Button>
      {change && <ChangeCard change={change} />}
    </>
  );
}

export function PickTypeExercise({ done, onSolved }: { done?: boolean; onSolved: () => void }) {
  return (
    <Shell title="1 · Pick the type" done={done}>
      <p className="text-[12px] text-muted">Six requirements. Choose the SCD type for each; solved when all six are right in one check.</p>
      <TypeMatcher items={PICK_CARDS} done={done} onSolved={onSolved} label="pick-type" />
    </Shell>
  );
}

export function AsWasExercise({ done, onSolved }: { done?: boolean; onSolved: () => void }) {
  return (
    <Shell title="3 · Which type produced this report?" done={done}>
      <p className="text-[12px] text-muted">After Asha’s whole timeline (₹70k of sales: ₹20k while in Pune, ₹50k in Mumbai), each output below came from one type.</p>
      <TypeMatcher items={ASWAS_QS} done={done} onSolved={onSolved} label="as-was-as-is" />
    </Shell>
  );
}

export function PlayType2Exercise({ done, answered, onLoad }: { done?: boolean; answered: { key: string; label: string; ok?: boolean }[]; onLoad: () => void }) {
  return (
    <Shell title="2 · Play Type 2 end to end" done={done}>
      <p className="text-[12px] text-muted">Select Type 2, play Jan → Jun and commit to every prediction on the way. Solved when you reach June with all three answered.</p>
      <ul className="space-y-1">
        {answered.map((a) => (
          <li key={a.key} className="flex items-center gap-1.5 font-mono text-[11.5px]">
            <span className={cn(a.ok === undefined ? 'text-faint' : a.ok ? 'text-ok' : 'text-warn')}>{a.ok === undefined ? '○' : a.ok ? '✓' : '△'}</span>
            <span className={a.ok === undefined ? 'text-muted' : 'text-ink'}>{a.label}</span>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" icon={<Play size={13} />} onClick={onLoad}>
        Load Type 2 from January
      </Button>
    </Shell>
  );
}

export function LateFactExercise({ done, onSolved }: { done?: boolean; onSolved: () => void }) {
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState(false);
  const [change, setChange] = useState<Change | null>(null);
  const check = () => {
    setChecked(true);
    const right = LATE_FACTS.filter((f) => picks[f.id] === f.answer).length;
    setChange({
      key: `late-${Date.now()}`,
      title: `Routed ${Object.keys(picks).length}/${LATE_FACTS.length} late facts · **${right} correct**`,
      lines: LATE_FACTS.map((f) => {
        const p = picks[f.id];
        const row = LATE_DIM.find((r) => r.sk === p);
        return p === f.answer
          ? { tone: 'ok' as const, text: `${f.date} ${fmtK(f.amount)} → sk ${p}: revenue lands in ${row!.city} · ${row!.segment}, as it was on that day.` }
          : p
            ? { tone: 'bad' as const, text: `${f.date} ${fmtK(f.amount)} → sk ${p}: reported as ${row!.city} · ${row!.segment}, which was not true on ${f.date}.` }
            : { tone: 'warn' as const, text: `${f.date}: not assigned.` };
      }),
    });
    if (right === LATE_FACTS.length) onSolved();
  };
  return (
    <Shell title="4 · Late-arriving facts" done={done}>
      <p className="text-[12px] text-muted">
        It is June 30. Two sales from an offline store finally sync. Click the Type 2 version each should reference.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full font-mono text-[11px]">
          <thead className="bg-sunken text-faint">
            <tr>
              {['sk', 'city', 'segment', 'valid_from', 'valid_to', 'cur'].map((h) => (
                <th key={h} className="px-1.5 py-1 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LATE_DIM.map((r) => (
              <tr key={r.sk} className="border-t border-line">
                <td className="px-1.5 py-1 text-ink">{r.sk}</td>
                <td className="px-1.5 py-1">{r.city}</td>
                <td className="px-1.5 py-1">{r.segment}</td>
                <td className="px-1.5 py-1">{r.validFrom}</td>
                <td className="px-1.5 py-1 text-muted">{r.validTo}</td>
                <td className={cn('px-1.5 py-1', r.isCurrent ? 'text-ok' : 'text-faint')}>{String(r.isCurrent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {LATE_FACTS.map((f) => {
        const p = picks[f.id];
        const ok = checked && p === f.answer;
        const bad = checked && p !== undefined && p !== f.answer;
        return (
          <div key={f.id} className={cn('rounded-lg border p-2', ok ? 'border-ok/50 bg-ok/[0.05]' : bad ? 'border-bad/50 bg-bad/[0.05]' : 'border-line')}>
            <div className="font-mono text-[11.5px] text-ink">
              sale_date <b>{f.date}</b> · {fmtK(f.amount)} · arrived {f.arrived}
            </div>
            <div className="mt-1.5 flex gap-1">
              {LATE_DIM.map((r) => (
                <button
                  key={r.sk}
                  onClick={() => {
                    setPicks((x) => ({ ...x, [f.id]: r.sk }));
                    setChecked(false);
                  }}
                  className={cn(
                    'h-6 flex-1 rounded border font-mono text-[11px] transition',
                    p === r.sk ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-muted hover:border-accent hover:text-ink',
                  )}
                >
                  sk {r.sk}
                </button>
              ))}
            </div>
            {bad && (
              <p className="mt-1.5 text-[11.5px] leading-snug text-bad">
                ✗ <span className="text-muted"><Rich text={f.wrong[p!] ?? ''} /></span>
              </p>
            )}
            {ok && (
              <p className="mt-1.5 text-[11.5px] text-ok">
                ✓ <span className="text-muted"><Rich text={`\`valid_from <= ${f.date} < valid_to\` matches exactly sk ${f.answer}.`} /></span>
              </p>
            )}
          </div>
        );
      })}
      <Button size="sm" variant={done ? 'success' : 'primary'} onClick={check}>
        Check routing
      </Button>
      {change && <ChangeCard change={change} />}
      {checked && LATE_FACTS.some((f) => picks[f.id] === 3 && f.answer !== 3) && (
        <Callout tone="bad" title="Red flag: resolving by is_current">
          <span className="text-[12px]"><Rich text="Late facts must be resolved by the event date. Use `sale_date >= valid_from AND sale_date < valid_to` instead of `WHERE is_current`: the current version describes June, not April." /></span>
        </Callout>
      )}
    </Shell>
  );
}
