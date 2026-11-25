import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Button, Callout, ProgressBar, Tag } from '@/shared/ui';
import { cn } from '@/shared/cn';
import type { Concept, TransferItem } from '../types';
import { CONCEPTS, conceptById } from '../content';
import { trackName } from '../content/tracks';
import { useSql } from '../store';
import { Md, PageHeader, shuffle, trackTone } from '../ui/common';

interface Q {
  concept: Concept;
  item: TransferItem;
  options: Concept[];
}

const ROUND = 10;

function makeRound(seed: number): Q[] {
  const pool = CONCEPTS.flatMap((c) => c.transfer.map((item) => ({ c, item })));
  // interleave: never two questions from the same track back to back when avoidable
  const picked: { c: Concept; item: TransferItem }[] = [];
  const rest = shuffle(pool, seed);
  while (picked.length < Math.min(ROUND, pool.length) && rest.length) {
    const lastTrack = picked[picked.length - 1]?.c.track;
    const i = rest.findIndex((x) => x.c.track !== lastTrack && !picked.some((p) => p.c.id === x.c.id));
    picked.push(rest.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return picked.map(({ c, item }, k) => {
    const confusable = c.confusable.map(conceptById).filter((x): x is Concept => !!x && x.id !== c.id);
    const others = shuffle(
      CONCEPTS.filter((x) => x.id !== c.id && !confusable.includes(x)),
      seed + k,
    );
    const distractors = [...shuffle(confusable, seed * 7 + k).slice(0, 2), ...others].slice(0, 3);
    return { concept: c, item, options: shuffle([c, ...distractors], seed * 13 + k) };
  });
}

export default function Drill() {
  const recordDrill = useSql((s) => s.recordDrill);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e6));
  const round = useMemo(() => makeRound(seed), [seed]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const q = round[i];
  const done = i >= round.length;

  const answer = (id: string) => {
    if (picked) return;
    setPicked(id);
    const ok = id === q.concept.id;
    if (ok) setScore((s) => s + 1);
    recordDrill(q.concept.id, q.item.id, ok);
  };
  const nextQ = () => {
    setPicked(null);
    setI((x) => x + 1);
  };
  const restart = () => {
    setSeed(Math.floor(Math.random() * 1e6));
    setI(0);
    setScore(0);
    setPicked(null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Interleaved recognition" title="Which technique?">
        Interview and on-the-job questions never say “use a window function”. Read the business question, pick the technique, then compare with an approach sketch. Questions are shuffled across tracks on purpose: telling techniques apart is the skill.
      </PageHeader>
      {!done && q ? (
        <motion.div key={i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
          <div className="flex items-center gap-3">
            <ProgressBar value={i} max={round.length} size="xs" className="flex-1" />
            <span className="font-mono text-[11px] text-muted">
              {i + 1}/{round.length} · {score} right
            </span>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 text-[15px] leading-relaxed text-ink shadow-paper">
            <Md text={q.item.scenario} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => {
              const isRight = o.id === q.concept.id;
              const state = picked ? (isRight ? 'right' : o.id === picked ? 'wrong' : 'idle') : 'idle';
              return (
                <button
                  key={o.id}
                  onClick={() => answer(o.id)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition',
                    state === 'right' ? 'border-ok bg-ok/[0.07]' : state === 'wrong' ? 'border-bad bg-bad/[0.06]' : 'border-line bg-surface hover:border-ink/40',
                    picked && state === 'idle' && 'opacity-50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {state === 'right' && <CheckCircle2 className="h-4 w-4 text-ok" />}
                    {state === 'wrong' && <XCircle className="h-4 w-4 text-bad" />}
                    <span className="font-medium text-ink">{o.title}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">{o.tagline}</div>
                </button>
              );
            })}
          </div>
          {picked && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <Callout tone={picked === q.concept.id ? 'ok' : 'bad'} title={picked === q.concept.id ? 'Right technique' : `It’s ${q.concept.title}`}>
                <div className="mb-1 text-[12px]">
                  Signals:{' '}
                  {q.concept.signals.slice(0, 3).map((s, k) => (
                    <Tag key={k} tone="violet" className="mr-1">
                      {s.replace(/[`*]/g, '')}
                    </Tag>
                  ))}
                </div>
                <Md text={q.item.approach} />
              </Callout>
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={nextQ}>
                  {i + 1 < round.length ? 'Next question' : 'See results'}
                </Button>
                <Link to={`/sql/c/${q.concept.id}`} className="text-[13px] text-muted hover:text-ink">
                  open “{q.concept.title}” <Tag tone={trackTone[q.concept.track]}>{trackName(q.concept.track)}</Tag>
                </Link>
              </div>
            </motion.div>
          )}
        </motion.div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-paper">
          <div className="text-3xl font-semibold text-ink">
            {score}/{round.length}
          </div>
          <p className="mt-1 text-sm text-muted">{score >= round.length * 0.8 ? 'Strong recognition. Push on with judgment drills.' : 'Misses show which concepts blur together. Revisit them, then drill again tomorrow.'}</p>
          <Button className="mt-4" variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={restart}>
            New round
          </Button>
        </div>
      )}
    </div>
  );
}
