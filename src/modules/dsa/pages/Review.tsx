import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Blocks, CalendarClock, Eye, PartyPopper } from 'lucide-react';
import { Button, CodeBlock, Callout } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { RecallGrade } from '@/shared/progress';
import { parseCode } from '../engine/tracer';
import { problemById } from '../problems';
import { patternById } from '../data/patterns';
import { isProblemDue, useDsa } from '../store';
import { DifficultyTag, PageHeader, PatternTag } from '../components/common';
import { LangSwitch } from '../components/LangSwitch';
import { LANG_META, problemCode } from '../lang/code';
import { useLang } from '../lang/store';

export default function Review() {
  const prog = useDsa((s) => s.problems);
  const grade = useDsa((s) => s.grade);
  // snapshot the due list when the page opens so grading doesn't reshuffle it
  const [queue] = useState(() =>
    Object.entries(useDsa.getState().problems)
      .filter(([id, p]) => problemById[id] && isProblemDue(p))
      .sort((a, b) => (a[1].card!.due < b[1].card!.due ? -1 : 1))
      .map(([id]) => id),
  );
  const [i, setI] = useState(0);
  const [stage, setStage] = useState<'recall' | 'reveal'>('recall');
  const [plan, setPlan] = useState('');

  const upcoming = useMemo(
    () =>
      Object.entries(prog)
        .filter(([id, p]) => problemById[id] && p.card && !isProblemDue(p))
        .sort((a, b) => (a[1].card!.due < b[1].card!.due ? -1 : 1))
        .slice(0, 12),
    [prog],
  );

  const id = queue[i];
  const p = id ? problemById[id] : undefined;
  const lang = useLang();
  const code = useMemo(() => (p ? parseCode(problemCode(p, lang)).map((l) => l.text).join('\n') : ''), [p, lang]);

  const rate = (g: RecallGrade) => {
    grade(id, g);
    setI((x) => x + 1);
    setStage('recall');
    setPlan('');
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Spaced repetition" title="Review queue">
        Recalling a solution right before you would forget it is the single most effective way to make it permanent. Problems enter this queue once you build
        them without the worked example; each honest rating pushes the next review further out.
      </PageHeader>

      {!queue.length ? (
        <Callout tone="ok" title="Nothing due right now">
          Build more problems in <b>Fill the gaps</b> or <b>From scratch</b> mode and they will show up here when they are due.
        </Callout>
      ) : !p ? (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="rounded-xl border border-ok/40 bg-ok/10 p-6 text-center">
          <PartyPopper className="mx-auto h-8 w-8 text-ok" />
          <div className="mt-2 text-lg font-semibold text-ink">Review session complete — {queue.length} recalled.</div>
          <Link to="/dsa/drill" className="mt-2 inline-block text-sm text-muted underline hover:text-ink">
            Keep going with a recognition drill →
          </Link>
        </motion.div>
      ) : (
        <motion.div key={p.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {i + 1} of {queue.length} due
            </span>
            <span>{patternById[p.pattern]?.name}</span>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 shadow-paper">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-faint">{p.num}.</span>
              <span className="font-semibold text-ink">{p.title}</span>
              <DifficultyTag d={p.difficulty} />
            </div>
            <p className="text-[15px] leading-relaxed text-ink">{p.statement}</p>
          </div>

          {stage === 'recall' ? (
            <div className="rounded-xl border-2 border-violet/40 bg-violet/5 p-4">
              <div className="mb-2 text-sm font-semibold text-ink">From memory: pattern, key insight, and the main loop.</div>
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                rows={5}
                placeholder={'pattern: …\ninsight: …\nloop: for … / while …'}
                className="w-full rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
              />
              <div className="mt-2 flex gap-2">
                <Button variant="primary" icon={<Eye className="h-4 w-4" />} onClick={() => setStage('reveal')}>
                  Reveal & compare
                </Button>
                <Link to={`/dsa/problem/${p.id}?tab=build`}>
                  <Button variant="secondary" icon={<Blocks className="h-4 w-4" />}>
                    Rebuild with blocks instead
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="eyebrow mb-1">pattern</div>
                  <PatternTag id={p.pattern} />
                  <div className="eyebrow mb-1 mt-3">key insight</div>
                  <p className="text-sm text-ink">{p.insight}</p>
                  {plan && (
                    <>
                      <div className="eyebrow mb-1 mt-3">what you wrote</div>
                      <pre className="whitespace-pre-wrap font-mono text-xs text-muted">{plan}</pre>
                    </>
                  )}
                </div>
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  <div className="flex justify-end border-b border-line px-2 py-1">
                    <LangSwitch size="xs" />
                  </div>
                  <CodeBlock code={code} language={LANG_META[lang].prism} className="max-h-80 overflow-auto text-[12px]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    [0, 'Again', 'forgot it', 'danger'],
                    [1, 'Hard', 'partly', 'secondary'],
                    [2, 'Good', 'got it with effort', 'success'],
                    [3, 'Easy', 'instant', 'primary'],
                  ] as const
                ).map(([g, label, hint, variant]) => (
                  <Button key={g} variant={variant} className="flex h-auto flex-col py-2" onClick={() => rate(g)}>
                    <span className="font-semibold">{label}</span>
                    <span className="text-[10px] font-normal opacity-80">{hint}</span>
                  </Button>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}

      <section className="mt-10">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <CalendarClock className="h-4 w-4 text-muted" /> Coming up
        </h2>
        {!upcoming.length ? (
          <p className="text-sm text-faint">No scheduled reviews yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {upcoming.map(([pid, pp]) => (
              <Link
                key={pid}
                to={`/dsa/problem/${pid}`}
                className={cn('flex items-center justify-between border-t border-line/60 px-4 py-2 text-sm first:border-t-0 hover:bg-sunken/40')}
              >
                <span className="text-ink">{problemById[pid].title}</span>
                <span className="font-mono text-xs text-muted">{new Date(pp.card!.due).toLocaleDateString()}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
