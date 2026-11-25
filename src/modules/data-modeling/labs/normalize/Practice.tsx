import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Check, RotateCcw, Scissors, Undo2, X } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import type { Change } from '../../ui/ChangeCard';
import { Rich } from '../../ui/Rich';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import { CLASSIFY, DEC_CHOICES, DEC_FDS, DEC_NAMES, DEC_U, ENROLL_COLS, ENROLL_FDS, ENROLL_ROWS, type DecChoice } from './data';
import { NF_LABEL, analyzeNF, fmtFD, fmtSet, isLossless, lostDependencies, naturalJoin, project, setKey, showVal, splitOn, type NF } from './engine';
import { ChangeFeed, NFBadge, SchemaCard, Shell } from './ui';

type Drill = 'classify' | 'decompose' | 'bcnf';

const DRILLS: { id: Drill; label: string; ex: string }[] = [
  { id: 'classify', label: 'Classify', ex: 'classify-nf' },
  { id: 'decompose', label: 'Decompose', ex: 'decompose' },
  { id: 'bcnf', label: 'BCNF case', ex: 'bcnf' },
];

const KIND_TEXT: Record<string, string> = {
  partial: 'partial dependency (breaks 2NF)',
  transitive: 'transitive dependency (breaks 3NF)',
  bcnf: 'non-superkey determines a key column (breaks BCNF)',
};

export function Practice({ topic, header, footer }: { topic: LabTopic; header: ReactNode; footer: ReactNode }) {
  const [drill, setDrill] = useState<Drill>('classify');
  const done = useDm((s) => s.topics[topic.id]?.exercises) ?? {};
  const [changes, setChanges] = useState<Change[]>([]);
  const push = (c: Omit<Change, 'key'>) => setChanges((cs) => [{ ...c, key: `${Date.now()}-${cs.length}` }, ...cs].slice(0, 6));

  const tabs = (
    <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
      {DRILLS.map((d) => (
        <button
          key={d.id}
          onClick={() => setDrill(d.id)}
          className={cn('flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 font-mono text-[11.5px]', drill === d.id ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
        >
          {done[d.ex] && <Check size={12} className={drill === d.id ? 'text-paper' : 'text-ok'} />}
          {d.label}
        </button>
      ))}
    </div>
  );

  const props = { topic, push };
  const body = (
    <>
      <div className={cn(drill !== 'classify' && 'hidden')}>
        <ClassifyDrill {...props} />
      </div>
      <div className={cn(drill !== 'decompose' && 'hidden')}>
        <DecomposeDrill {...props} />
      </div>
      <div className={cn(drill !== 'bcnf' && 'hidden')}>
        <BcnfDrill {...props} />
      </div>
    </>
  );

  return (
    <Shell
      header={header}
      footer={footer}
      left={
        <>
          {tabs}
          <DrillIntro drill={drill} />
          <ChangeFeed changes={changes} label="What your actions changed" />
        </>
      }
      center={<div className="p-6">{body}</div>}
    />
  );
}

function DrillIntro({ drill }: { drill: Drill }) {
  const text: Record<Drill, { title: string; body: string[]; goal: string }> = {
    classify: {
      title: 'Name the highest normal form',
      body: [
        'Each card is a table with its functional dependencies drawn as lanes above the columns (dot = determinant, arrow = dependent). Lanes are grey until you check.',
        'Work it out: find the candidate keys, then test each FD. **Partial** (part of a key → non-key) breaks 2NF. **Transitive** (non-key → non-key) breaks 3NF. **Any** determinant that is not a superkey breaks BCNF.',
      ],
      goal: 'Solved when all 5 are right in one check.',
    },
    decompose: {
      title: 'Decompose to 3NF',
      body: [
        '`enrollment_sheet` mixes students, advisors, courses and grades. Pick a table, then pick the FD to split on: the FD becomes its own table and its dependents leave the original.',
        'Watch the status panel. **Lossless**: the chase test says joining the tables gives back exactly the original rows. **Dependency-preserving**: each FD can still be checked inside one table.',
      ],
      goal: 'Solved when every table is ≥ 3NF, the join is lossless and no FD is lost.',
    },
    bcnf: {
      title: 'Resolve the BCNF case',
      body: [
        '`enrollment(student, course, instructor)` with `{student, course} → instructor` and `instructor → course`. It is 3NF but not BCNF.',
        'Pick the decomposition you would ship: the join is run on the sample rows, so spurious rows show up in red. Then name the dependency you gave up.',
      ],
      goal: 'Solved with the lossless split and the right lost FD.',
    },
  };
  const t = text[drill];
  return (
    <div className="space-y-2">
      <h2 className="font-mono text-[16px] font-semibold">{t.title}</h2>
      {t.body.map((b, i) => (
        <p key={i} className="text-[13px] leading-relaxed text-muted">
          <Rich text={b} />
        </p>
      ))}
      <div className="font-mono text-[11px] text-accent">{t.goal}</div>
    </div>
  );
}

type DrillProps = { topic: LabTopic; push: (c: Omit<Change, 'key'>) => void };

/* ───────────────────────── classify ───────────────────────── */

const NF_OPTIONS: NF[] = [0, 1, 2, 3, 4];

function ClassifyDrill({ topic, push }: DrillProps) {
  const markExercise = useDm((s) => s.markExercise);
  const [picks, setPicks] = useState<Record<string, NF>>({});
  const [checked, setChecked] = useState(false);
  const [runs, setRuns] = useState(0);
  const reports = useMemo(() => Object.fromEntries(CLASSIFY.map((c) => [c.id, analyzeNF(c.cols, c.fds, c.multi)])), []);
  const all = CLASSIFY.every((c) => picks[c.id] !== undefined);
  const score = CLASSIFY.filter((c) => picks[c.id] === reports[c.id].nf).length;

  const check = () => {
    setChecked(true);
    setRuns((r) => r + 1);
    const ok = score === CLASSIFY.length;
    if (ok) markExercise(topic.id, 'classify-nf');
    push({
      title: `Check #${runs + 1}: ${score} / ${CLASSIFY.length} right`,
      lines: CLASSIFY.map((c) => {
        const right = picks[c.id] === reports[c.id].nf;
        return { tone: right ? 'ok' : 'bad', text: `\`${c.name}\`: you said ${NF_LABEL[picks[c.id]]}, it is **${NF_LABEL[reports[c.id].nf]}**` };
      }),
    });
  };
  const retry = () => {
    setChecked(false);
    setPicks({});
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {CLASSIFY.map((c, idx) => {
          const rep = reports[c.id];
          const pick = picks[c.id];
          const right = pick === rep.nf;
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
              <SchemaCard
                name={`${idx + 1}. ${c.name}`}
                cols={c.cols}
                fds={c.fds}
                multi={c.multi}
                colW={112}
                neutral={!checked}
                right={checked && <Tag size="sm" tone={right ? 'ok' : 'bad'}>{right ? 'right' : `it is ${NF_LABEL[rep.nf]}`}</Tag>}
                footer={
                  <div className="mt-2 space-y-2">
                    <div className="text-[12px] text-muted">
                      <Rich text={c.story} />
                    </div>
                    <div className="font-mono text-[10.5px] text-faint">FDs: {c.fds.map(fmtFD).join(' ; ')}</div>
                    <div className="flex flex-wrap gap-1">
                      {NF_OPTIONS.map((nf) => (
                        <button
                          key={nf}
                          disabled={checked}
                          onClick={() => setPicks((p) => ({ ...p, [c.id]: nf }))}
                          className={cn(
                            'rounded-md border px-2 py-1 font-mono text-[11px] transition-colors',
                            pick === nf
                              ? checked
                                ? right
                                  ? 'border-ok bg-ok/15 text-ok'
                                  : 'border-bad bg-bad/15 text-bad'
                                : 'border-accent bg-accent text-accent-ink'
                              : checked && nf === rep.nf
                                ? 'border-ok/60 text-ok'
                                : 'border-line text-muted hover:border-accent/50',
                          )}
                        >
                          {NF_LABEL[nf]}
                        </button>
                      ))}
                    </div>
                    <AnimatePresence>
                      {checked && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="space-y-0.5 overflow-hidden rounded-md bg-sunken/60 px-2 py-1.5 font-mono text-[11px] text-muted"
                        >
                          <div>
                            candidate keys: <span className="text-ink">{rep.keys.map(fmtSet).join(' , ')}</span>
                          </div>
                          {rep.multi.length > 0 && <div className="text-bad">`{rep.multi.join(', ')}` holds a list → not atomic, not even 1NF</div>}
                          {rep.multi.length === 0 && rep.violations.length === 0 && <div className="text-ok">every determinant is a superkey → BCNF</div>}
                          {rep.multi.length === 0 &&
                            rep.violations.map((v) => (
                              <div key={`${v.lhs}>${v.rhs}`} className={v.kind === 'partial' ? 'text-bad' : v.kind === 'transitive' ? 'text-warn' : 'text-violet'}>
                                {fmtSet(v.lhs)} → {v.rhs.join(', ')}: {KIND_TEXT[v.kind]}
                              </div>
                            ))}
                          {c.id === 'address' && <div className="text-faint">zip → city is allowed by 3NF only because city is prime (in key {'{street, city}'}).</div>}
                          {c.id === 'account' && <div className="text-faint">email is a second candidate key, so email → user_id is a key FD.</div>}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                }
              />
            </motion.div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {!checked ? (
          <Button variant="primary" disabled={!all} onClick={check}>
            Check all 5
          </Button>
        ) : (
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={retry}>
            Try again
          </Button>
        )}
        <span className="font-mono text-[12px] text-muted">
          {checked ? (
            <span className={score === CLASSIFY.length ? 'text-ok' : 'text-warn'}>
              {score} / {CLASSIFY.length} right{score === CLASSIFY.length ? ': solved' : ': all 5 must be right in one run'}
            </span>
          ) : (
            `${Object.keys(picks).length} / ${CLASSIFY.length} picked`
          )}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── decompose ───────────────────────── */

interface DecTable {
  id: string;
  name: string;
  cols: string[];
}

const START: DecTable[] = [{ id: 't0', name: 'enrollment_sheet', cols: DEC_U }];

const sameSet = (a: string[], b: string[]) => setKey(a) === setKey(b);

function DecomposeDrill({ topic, push }: DrillProps) {
  const markExercise = useDm((s) => s.markExercise);
  const [history, setHistory] = useState<DecTable[][]>([START]);
  const [sel, setSel] = useState('t0');
  const [used, setUsed] = useState<string[]>([]);
  const tables = history[history.length - 1];
  const selT = tables.find((t) => t.id === sel) ?? tables[0];

  const status = useMemo(() => {
    const cols = tables.map((t) => t.cols);
    const nfs = tables.map((t) => analyzeNF(t.cols, DEC_FDS));
    const lossless = isLossless(DEC_U, cols, DEC_FDS);
    const lost = lostDependencies(cols, DEC_FDS);
    const allNF = nfs.every((r) => r.nf >= 3);
    return { nfs, lossless, lost, allNF, solved: allNF && lossless && lost.length === 0 };
  }, [tables]);

  const applicable = (c: DecChoice) => {
    const all = [...c.lhs, ...c.rhs];
    if (!all.every((a) => selT.cols.includes(a))) return false;
    const [r1, r2] = splitOn(selT.cols, c);
    return r1.length < selT.cols.length && r2.length < selT.cols.length && !sameSet(r1, r2);
  };

  const apply = (c: DecChoice) => {
    const [r1, r2] = splitOn(selT.cols, c);
    const base = DEC_NAMES[c.lhs.join()] ?? `${c.lhs.join('_')}_${c.rhs.join('_')}`;
    const taken = new Set(tables.map((t) => t.name));
    const name = taken.has(base) ? `${base}_${tables.length}` : base;
    const n = history.length;
    const next = tables.flatMap((t) =>
      t.id === selT.id
        ? [
            { id: `t${n}a`, name, cols: r1 },
            { id: t.id, name: t.name, cols: r2 },
          ]
        : [t],
    );
    setHistory((h) => [...h, next]);
    setUsed((u) => [...u, c.id]);
    const nCols = next.map((t) => t.cols);
    const lossless = isLossless(DEC_U, nCols, DEC_FDS);
    const lost = lostDependencies(nCols, DEC_FDS);
    const allNF = next.every((t) => analyzeNF(t.cols, DEC_FDS).nf >= 3);
    const solved = allNF && lossless && lost.length === 0;
    if (solved) markExercise(topic.id, 'decompose');
    push({
      title: `Split \`${selT.name}\` on ${fmtFD(c)}`,
      lines: [
        { tone: 'info', text: `\`${name}(${r1.join(', ')})\` + \`${selT.name}(${r2.join(', ')})\`` },
        lossless
          ? { tone: 'ok', text: 'Lossless: the shared columns are a key of one side.' }
          : { tone: 'bad', text: `**Lossy**: shared column \`${c.lhs.join(', ')}\` is not a key of either side → the join invents rows.` },
        lost.length
          ? { tone: 'bad', text: `Lost FD: ${lost.map((f) => `\`${fmtFD(f)}\``).join(', ')} spans tables now.` }
          : { tone: 'ok', text: 'All FDs still checkable inside one table.' },
        solved ? { tone: 'ok', text: '**3NF, lossless, dependency-preserving: solved.**' } : { tone: 'info', text: `${next.length} tables · ${next.length - 1} joins to rebuild the sheet` },
      ],
    });
  };

  const undo = () => {
    if (history.length < 2) return;
    setHistory((h) => h.slice(0, -1));
    setUsed((u) => u.slice(0, -1));
  };
  const reset = () => {
    setHistory([START]);
    setUsed([]);
    setSel('t0');
  };

  const selRep = analyzeNF(selT.cols, DEC_FDS);
  const trapAdv = used.includes('student-adv-name');
  const trapGrade = used.includes('course-grade');

  return (
    <div className="grid grid-cols-[1fr_300px] gap-5">
      <div className="space-y-4">
        <LayoutGroup>
          <motion.div layout className="flex flex-wrap items-start gap-4">
            <AnimatePresence mode="popLayout">
              {tables.map((t, i) => (
                <SchemaCard
                  key={t.id}
                  layoutKey={t.id}
                  name={t.name}
                  cols={t.cols}
                  fds={DEC_FDS}
                  colW={t.cols.length > 4 ? 98 : 108}
                  selected={t.id === selT.id}
                  onClick={() => setSel(t.id)}
                  focus={t.id === selT.id ? selRep.violations.map((v) => v.lhs) : null}
                  right={<NFBadge nf={status.nfs[i]?.nf ?? 0} />}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>

        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="mb-2 flex items-center gap-2">
            <Scissors size={14} className="text-accent" />
            <span className="font-mono text-[12px] font-semibold">
              Split <span className="text-accent">{selT.name}</span> on…
            </span>
            <span className="ml-auto flex gap-1">
              <Button size="xs" variant="ghost" icon={<Undo2 size={12} />} disabled={history.length < 2} onClick={undo}>
                Undo
              </Button>
              <Button size="xs" variant="ghost" icon={<RotateCcw size={12} />} onClick={reset}>
                Reset
              </Button>
            </span>
          </div>
          {selRep.violations.length > 0 ? (
            <div className="mb-2 font-mono text-[11px] text-muted">
              violations in this table:{' '}
              {selRep.violations.map((v) => (
                <span key={`${v.lhs}>${v.rhs}`} className={cn('mr-2', v.kind === 'partial' ? 'text-bad' : v.kind === 'transitive' ? 'text-warn' : 'text-violet')}>
                  {fmtSet(v.lhs)} → {v.rhs.join(', ')} ({v.kind})
                </span>
              ))}
            </div>
          ) : (
            <div className="mb-2 font-mono text-[11px] text-ok">this table is BCNF: nothing left to split</div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {DEC_CHOICES.map((c) => {
              const ok = applicable(c);
              return (
                <button
                  key={c.id}
                  disabled={!ok}
                  onClick={() => apply(c)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-left font-mono text-[11px] transition-colors',
                    ok ? 'border-line bg-paper hover:border-accent hover:bg-accent/5' : 'cursor-not-allowed border-line/50 text-faint opacity-50',
                  )}
                >
                  <div className={ok ? 'text-ink' : ''}>{fmtFD(c)}</div>
                  <div className="text-[10px] text-faint">{c.note}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="eyebrow mb-2">Status</div>
          <StatusRow ok={status.allNF} label="Every table ≥ 3NF" detail={tables.map((t, i) => `${t.name}: ${NF_LABEL[status.nfs[i].nf]}`).join(' · ')} />
          <StatusRow ok={status.lossless} label="Lossless join (chase test)" detail={status.lossless ? 'join returns exactly the original rows' : 'join produces spurious rows'} />
          <StatusRow
            ok={status.lost.length === 0}
            label="Dependency-preserving"
            detail={status.lost.length ? `lost: ${status.lost.map(fmtFD).join(', ')}` : 'each FD fits inside one table'}
          />
          <div className="mt-2 font-mono text-[11px] text-muted">
            {tables.length} tables · {history.length - 1} split{history.length === 2 ? '' : 's'}
          </div>
          <AnimatePresence>
            {status.solved && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-2 rounded-md bg-ok/15 px-2 py-1.5 font-mono text-[12px] font-semibold text-ok">
                Solved: 3NF, lossless, dependency-preserving
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {trapGrade && (
          <Callout tone="bad" title="course_id → grade is not an FD">
            <span className="text-[12px]">
              Two students in one course get different grades. Splitting on it puts <code>grade</code> next to <code>course_id</code> only: the shared column <code>course_id</code> is not a key of
              either side, so the join pairs every grade with every student in the course. Undo it.
            </span>
          </Callout>
        )}
        {trapAdv && (
          <Callout tone="warn" title="Implied FD: lossless, but lost advisor_id → advisor_name">
            <span className="text-[12px]">
              <code>student_id → advisor_name</code> holds (by transitivity), so the split is lossless and each table can be BCNF. But <code>advisor_id</code> and{' '}
              <code>advisor_name</code> now sit in different tables: nothing stops one advisor having two names. Split on the <b>given</b> FD instead.
            </span>
          </Callout>
        )}
        <Callout tone="info" title="Heath's theorem">
          <span className="text-[12px]">
            If <code>X → Y</code> holds in R, then R = (X ∪ Y) ⋈ (R − Y) is lossless. Splitting on a real FD whose left side stays in both tables is always safe.
          </span>
        </Callout>
      </div>
    </div>
  );
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex gap-2 border-t border-line/60 py-1.5 first-of-type:border-t-0">
      <motion.span key={String(ok)} initial={{ scale: 0.4 }} animate={{ scale: 1 }} className={cn('mt-0.5 shrink-0', ok ? 'text-ok' : 'text-bad')}>
        {ok ? <Check size={14} /> : <X size={14} />}
      </motion.span>
      <div>
        <div className="text-[12.5px] font-medium">{label}</div>
        <div className="font-mono text-[10.5px] text-muted">{detail}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── BCNF case ───────────────────────── */

interface BcnfOption {
  id: string;
  a: string[];
  b: string[];
}

const BCNF_OPTIONS: BcnfOption[] = [
  { id: 'si-ic', a: ['student', 'instructor'], b: ['instructor', 'course'] },
  { id: 'sc-ci', a: ['student', 'course'], b: ['course', 'instructor'] },
  { id: 'sc-si', a: ['student', 'course'], b: ['student', 'instructor'] },
];

const LOST_OPTIONS = ['instructor → course', '{student, course} → instructor', 'student → course', 'Nothing is lost'];
const LOST_ANSWER = 1;

const rowSig = (r: Record<string, unknown>) => ENROLL_COLS.map((c) => String(r[c])).join('|');
const ORIGINAL = new Set(ENROLL_ROWS.map(rowSig));

function BcnfDrill({ topic, push }: DrillProps) {
  const markExercise = useDm((s) => s.markExercise);
  const [pick, setPick] = useState<string | null>(null);
  const [lost, setLost] = useState<number | null>(null);

  const results = useMemo(
    () =>
      BCNF_OPTIONS.map((o) => {
        const A = project(ENROLL_ROWS, o.a);
        const B = project(ENROLL_ROWS, o.b);
        const join = naturalJoin(A, B);
        const spurious = join.filter((r) => !ORIGINAL.has(rowSig(r))).length;
        const reps = [analyzeNF(o.a, ENROLL_FDS), analyzeNF(o.b, ENROLL_FDS)];
        return { o, A, B, join, spurious, reps, lostFds: lostDependencies([o.a, o.b], ENROLL_FDS) };
      }),
    [],
  );
  const right = results.find((r) => r.spurious === 0)!;
  const chosen = results.find((r) => r.o.id === pick);
  const solved = pick === right.o.id && lost === LOST_ANSWER;

  const choose = (id: string) => {
    setPick(id);
    const r = results.find((x) => x.o.id === id)!;
    if (r.spurious === 0 && lost === LOST_ANSWER) markExercise(topic.id, 'bcnf');
    push({
      title: `Decompose into (${r.o.a.join(', ')}) + (${r.o.b.join(', ')})`,
      lines: [
        r.spurious
          ? { tone: 'bad', text: `Join returns **${r.join.length} rows** for 5 originals: ${r.spurious} spurious.` }
          : { tone: 'ok', text: `Join returns exactly the **5** original rows: lossless.` },
        { tone: 'info', text: `Shared column \`${r.o.a.filter((c) => r.o.b.includes(c)).join()}\` ${r.spurious ? 'is not a key of either side' : 'is the key of `teaches`'}.` },
      ],
    });
  };
  const answerLost = (i: number) => {
    setLost(i);
    const ok = i === LOST_ANSWER;
    if (ok && pick === right.o.id) markExercise(topic.id, 'bcnf');
    push({
      title: `Lost dependency: ${LOST_OPTIONS[i]}`,
      lines: ok
        ? [
            { tone: 'ok', text: '`{student, course} → instructor` needs `student` and `course` together; no table has both.' },
            { tone: 'warn', text: 'Enforce with a trigger joining `teaches`, or stay in 3NF with `UNIQUE (student, course)` + composite FK.' },
          ]
        : [{ tone: 'bad', text: i === 0 ? '`instructor → course` is the PK of `teaches`: enforced.' : 'Run the preservation test: which FD has no table holding all its columns?' }],
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {results.map((r, i) => {
          const isPick = pick === r.o.id;
          return (
            <motion.button
              key={r.o.id}
              layout
              onClick={() => choose(r.o.id)}
              className={cn('rounded-xl border bg-surface p-3 text-left transition-colors', isPick ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-accent/50')}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-[12px] font-semibold">Option {String.fromCharCode(65 + i)}</span>
                {pick && <Tag size="sm" tone={r.spurious ? 'bad' : 'ok'}>{r.spurious ? `lossy · +${r.spurious} rows` : 'lossless'}</Tag>}
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div>
                  R1({r.o.a.join(', ')}) {pick && <span className="text-faint">· {NF_LABEL[r.reps[0].nf]}</span>}
                </div>
                <div>
                  R2({r.o.b.join(', ')}) {pick && <span className="text-faint">· {NF_LABEL[r.reps[1].nf]}</span>}
                </div>
              </div>
              <div className="mt-2 font-mono text-[10.5px] text-muted">
                {r.A.length} + {r.B.length} rows stored
                {pick && <> · join → {r.join.length} rows</>}
              </div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {chosen && (
          <motion.div key={chosen.o.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap items-start gap-4">
            <MiniTable title={`R1(${chosen.o.a.join(', ')})`} cols={chosen.o.a} rows={chosen.A} />
            <MiniTable title={`R2(${chosen.o.b.join(', ')})`} cols={chosen.o.b} rows={chosen.B} />
            <MiniTable
              title={`R1 ⋈ R2 on ${chosen.o.a.filter((c) => chosen.o.b.includes(c)).join()}`}
              cols={ENROLL_COLS}
              rows={chosen.join}
              bad={(r) => !ORIGINAL.has(rowSig(r))}
              sub={`${chosen.join.length} rows · original 5`}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {chosen && chosen.spurious > 0 && (
        <Callout tone="bad" title="Lossy: the join invents enrollments">
          <span className="text-[12px]">
            The shared column is not a key of either side, so every row on one side pairs with every matching row on the other. Red rows never existed. Heath: split on a real FD (
            <code>instructor → course</code>) so the shared column is a key.
          </span>
        </Callout>
      )}

      {pick === right.o.id && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl rounded-xl border border-accent/50 bg-surface p-3">
          <div className="mb-2 text-[13px] font-medium">Both tables are BCNF and the join is lossless. Which dependency can no longer be enforced by a key?</div>
          <div className="grid grid-cols-2 gap-1.5">
            {LOST_OPTIONS.map((o, i) => (
              <button
                key={o}
                onClick={() => answerLost(i)}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-left font-mono text-[11.5px]',
                  lost === i ? (i === LOST_ANSWER ? 'border-ok bg-ok/15 text-ok' : 'border-bad bg-bad/15 text-bad') : 'border-line hover:border-accent/50',
                )}
              >
                {o}
              </button>
            ))}
          </div>
          {solved && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 font-mono text-[12px] font-semibold text-ok">
              Solved. Engine check: lost = {right.lostFds.map(fmtFD).join(', ')}
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function MiniTable({ title, cols, rows, bad, sub }: { title: string; cols: string[]; rows: Record<string, unknown>[]; bad?: (r: Record<string, unknown>) => boolean; sub?: string }) {
  return (
    <motion.div layout className="rounded-xl border border-line bg-surface p-2.5 shadow-paper">
      <div className="font-mono text-[12px] font-semibold">{title}</div>
      {sub && <div className="font-mono text-[10px] text-faint">{sub}</div>}
      <div className="mt-1 flex border-b border-line font-mono text-[10.5px] font-semibold text-muted">
        {cols.map((c) => (
          <span key={c} className="w-20 px-1">
            {c}
          </span>
        ))}
      </div>
      {rows.map((r, i) => {
        const isBad = bad?.(r);
        return (
          <motion.div
            key={cols.map((c) => String(r[c])).join('|')}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={cn('flex font-mono text-[11px]', isBad && 'bg-bad/15 font-semibold text-bad')}
          >
            {cols.map((c) => (
              <span key={c} className="w-20 truncate px-1 py-0.5">
                {showVal(r[c] as string)}
              </span>
            ))}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
