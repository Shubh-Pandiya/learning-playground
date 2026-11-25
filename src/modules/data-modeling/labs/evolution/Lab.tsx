import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, BookOpen, Dumbbell, FileJson, GitMerge } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Callout } from '@/shared/ui';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import { ChangeCard, type Change } from '../../ui/ChangeCard';
import { Rich } from '../../ui/Rich';
import { ExerciseChecklist } from '../scd/bits';
import { MISSIONS, type Mission } from './avro';
import { ContractPart } from './ContractPart';
import { MigrationPart } from './MigrationPart';
import { ROLLOUT_MIN, SCENARIOS, type ScenarioId } from './migrations';
import { ContractHood, MigrationHood } from './UnderTheHood';

type Part = 'migrate' | 'contract';
type Tab = 'guide' | 'ex';

const GUIDE: Record<Part, { title: string; body: string[] }[]> = {
  migrate: [
    {
      title: 'The one rule',
      body: [
        `Every schema state must work for **every app version that can be live at that moment**. A rolling deploy keeps v1 and v2 pods up together for ~${ROLLOUT_MIN} min; a rollback brings v1 back.`,
      ],
    },
    {
      title: 'Expand → migrate → contract',
      body: [
        '**Expand**: add the new column/table, nullable, no long lock.',
        '**Migrate**: keep old and new in sync (trigger or dual-write), backfill in batches, deploy code that uses the new shape.',
        '**Contract**: a release later, drop the sync and the old shape.',
      ],
    },
    {
      title: 'Locks that hurt',
      body: [
        'Rewrites (`ALTER COLUMN TYPE`), scans under ACCESS EXCLUSIVE (`SET NOT NULL`), index builds without `CONCURRENTLY`, inline FK validation, giant transactions. Any DDL without `lock_timeout` can queue the whole table behind it.',
      ],
    },
    {
      title: 'How to use the board',
      body: [
        'Drag cards into **Your plan** (top runs first) or the **Don’t do** bin; the buttons on each card do the same. Then simulate: each plan step becomes a row of ✓/✗ for v1 and v2 reads and writes, plus lock risk. After the first run the grid updates live as you rearrange.',
      ],
    },
  ],
  contract: [
    {
      title: 'Two schemas, always',
      body: [
        'A consumer decodes with its own **reader** schema the bytes written with the producer’s **writer** schema. Compatibility is a question about pairs: can this reader decode that writer?',
      ],
    },
    {
      title: 'The four cells',
      body: [
        '**new consumer × old data** = BACKWARD. **old consumer × new data** = FORWARD. Same-version cells always work. FULL needs both.',
      ],
    },
    {
      title: 'Who deploys first',
      body: ['BACKWARD → upgrade **consumers first**, then producers. FORWARD → **producers first**. FULL → any order. Neither → new topic.'],
    },
    {
      title: 'Rules of thumb (Avro)',
      body: [
        'Add or remove fields **with defaults**. Widen only along promotions (int→long). Renames need a reader alias, and only work BACKWARD. New enum symbols break old readers unless their enum has a default.',
      ],
    },
  ],
};

export default function EvolutionLab({ topic }: { topic: LabTopic }) {
  const markExercise = useDm((s) => s.markExercise);
  const recordPrediction = useDm((s) => s.recordPrediction);
  const exDone = useDm((s) => s.topics[topic.id]?.exercises);

  const [part, setPart] = useState<Part>('migrate');
  const [tab, setTab] = useState<Tab>('guide');
  const [scnId, setScnId] = useState<ScenarioId>('rename');
  const [mission, setMission] = useState<Mission | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [migPred, setMigPred] = useState<Record<string, number>>({});

  const solve = useCallback((exId: string) => markExercise(topic.id, exId), [markExercise, topic.id]);

  return (
    <div className="flex h-full min-h-0">
      {/* left: narration */}
      <aside className="flex w-[360px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="flex border-b border-line">
          {(
            [
              ['guide', 'Guide', BookOpen],
              ['ex', 'Exercises', Dumbbell],
            ] as const
          ).map(([t, label, Icon]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('flex flex-1 items-center justify-center gap-1.5 py-2 font-mono text-[11px] uppercase tracking-wider', tab === t ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-muted')}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {tab === 'guide' ? (
            <>
              <div className="space-y-2.5">
                {GUIDE[part].map((g) => (
                  <div key={g.title}>
                    <div className="eyebrow mb-0.5">{g.title}</div>
                    {g.body.map((b, i) => (
                      <p key={i} className="text-[12.5px] leading-relaxed text-muted">
                        <Rich text={b} />
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              <div className="border-t border-line pt-3">
                <div className="eyebrow mb-1">What just changed</div>
                <AnimatePresence mode="wait">
                  {change ? (
                    <motion.div key={change.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                      <ChangeCard change={change} />
                    </motion.div>
                  ) : (
                    <p className="font-mono text-[11px] text-faint">{part === 'migrate' ? 'Simulate a plan to see its impact here.' : 'Register a change to see its impact here.'}</p>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <>
              <ExerciseChecklist items={topic.exercises} done={exDone} />
              <div className="space-y-1.5">
                {SCENARIOS.map((s) => (
                  <ExerciseLink
                    key={s.exId}
                    done={!!exDone?.[s.exId]}
                    title={topic.exercises.find((e) => e.id === s.exId)?.title ?? s.short}
                    sub="Safe order, traps in the bin, zero ✗ in the rolling-deploy grid."
                    onOpen={() => {
                      setPart('migrate');
                      setScnId(s.id);
                    }}
                  />
                ))}
                {MISSIONS.map((m) => (
                  <ExerciseLink
                    key={m.exId}
                    done={!!exDone?.[m.exId]}
                    title={topic.exercises.find((e) => e.id === m.exId)?.title ?? m.title}
                    sub={`Mode locked to ${m.mode}; reach all four goals in the registered schema.`}
                    onOpen={() => {
                      setPart('contract');
                      setMission(m);
                    }}
                  />
                ))}
              </div>
              {change && (
                <div>
                  <div className="eyebrow mb-1">What just changed</div>
                  <ChangeCard change={change} compact />
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* centre: workspace */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-sunken/60 bg-grid">
        <div className="mx-auto max-w-[1080px] space-y-4 p-4">
          <div className="flex gap-1.5">
            {(
              [
                ['migrate', 'Part 1 · Zero-downtime migrations', GitMerge],
                ['contract', 'Part 2 · Data contract checker', FileJson],
              ] as const
            ).map(([p, label, Icon]) => (
              <button
                key={p}
                onClick={() => setPart(p)}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-[12px] font-semibold transition',
                  part === p ? 'border-accent bg-surface text-ink shadow-paper' : 'border-line bg-surface/60 text-muted hover:text-ink',
                )}
              >
                <Icon size={14} className={part === p ? 'text-accent' : ''} /> {label}
                {part === p && <motion.span layoutId="evo-part" className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" />}
              </button>
            ))}
          </div>

          {part === 'migrate' ? (
            <>
              <MigrationPart
                scnId={scnId}
                setScnId={setScnId}
                done={exDone}
                predicted={migPred}
                onPredict={(key, i, right) => {
                  setMigPred((p) => ({ ...p, [key]: i }));
                  recordPrediction(topic.id, key, right);
                }}
                onSolved={solve}
                onChange={setChange}
              />
              <MigrationHood />
            </>
          ) : (
            <>
              <ContractPart mission={mission} setMission={setMission} done={exDone} onSolved={solve} onChange={setChange} onPredict={(key, right) => recordPrediction(topic.id, key, right)} />
              <Callout tone="info" title="Matrix vs registry">
                <span className="text-[12px]">
                  The 2×2 matrix always compares the candidate with the latest registered version. The registry’s verdict depends on the mode: it may check one direction only, or every older version (transitive).
                </span>
              </Callout>
              <ContractHood />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ExerciseLink({ done, title, sub, onOpen }: { done: boolean; title: string; sub: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className={cn('flex w-full items-start gap-2 rounded-lg border p-2 text-left transition hover:border-accent', done ? 'border-ok/40 bg-ok/[0.06]' : 'border-line bg-surface')}>
      <span className={cn('mt-0.5 font-mono text-[12px]', done ? 'text-ok' : 'text-faint')}>{done ? '✓' : '○'}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-ink">{title}</span>
        <span className="block text-[11px] leading-snug text-muted">{sub}</span>
      </span>
      <ArrowRight size={13} className="mt-1 shrink-0 text-faint" />
    </button>
  );
}
