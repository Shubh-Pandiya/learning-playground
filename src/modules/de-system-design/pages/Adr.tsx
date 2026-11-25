import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, FileText, RotateCcw, Scale } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, Tag } from '@/shared/ui';
import { ADRS } from '../judgment/data/adrs';
import type { AdrCase } from '../judgment/types';
import { BackToPractice, PatternLinks } from '../judgment/ui';
import { useDesd } from '../store';
import { Rich } from '../ui/Rich';

const TEMPLATE = 'Decision: \nBecause: \nWe accept (tradeoffs): \nRevisit when: ';
const MIN_CHARS = 80;

function AdrDrill({ c }: { c: AdrCase }) {
  const draft = useDesd((s) => s.adrDrafts[c.id]);
  const save = useDesd((s) => s.saveAdrDraft);
  const record = useDesd((s) => s.recordDrill);
  const best = useDesd((s) => s.drills[`adr:${c.id}`]?.best);
  const [choice, setChoice] = useState<number | null>(draft?.choice ?? null);
  const [text, setText] = useState(draft?.text ?? TEMPLATE);
  const [compared, setCompared] = useState(false);
  const [selfTicked, setSelfTicked] = useState<Record<number, boolean>>({});

  const written = text.replace(/Decision:|Because:|We accept \(tradeoffs\):|Revisit when:/g, '').trim().length;
  const lower = text.toLowerCase();
  const auto = useMemo(() => c.considerations.map((k) => k.keywords.some((w) => lower.includes(w.toLowerCase()))), [c.considerations, lower]);
  const coverage = c.considerations.length ? c.considerations.reduce((a, _, i) => a + (auto[i] ? 1 : selfTicked[i] ? 0.5 : 0), 0) / c.considerations.length : 1;
  const score = Math.round(30 * (choice === c.recommended ? 1 : 0.3) + 70 * coverage);

  const persist = (ch: number | null, t: string) => save(c.id, { choice: ch, text: t });

  const compare = () => {
    setCompared(true);
    persist(choice, text);
    record('adr', c.id, score);
  };
  const toggleSelf = (i: number) => {
    const next = { ...selfTicked, [i]: !selfTicked[i] };
    setSelfTicked(next);
    const cov = c.considerations.reduce((a, _, k) => a + (auto[k] ? 1 : next[k] ? 0.5 : 0), 0) / c.considerations.length;
    record('adr', c.id, Math.round(30 * (choice === c.recommended ? 1 : 0.3) + 70 * cov));
  };

  return (
    <div className="mx-auto grid h-full max-w-[1200px] gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_1fr]">
      <section className="min-w-0 space-y-3">
        <BackToPractice />
        <div>
          <div className="eyebrow">Architecture decision record · lite</div>
          <h2 className="mt-0.5 font-mono text-[17px] font-semibold leading-snug">{c.title}</h2>
        </div>
        <p className="text-[13px] leading-relaxed text-muted">
          <Rich text={c.context} />
        </p>
        <PatternLinks ids={c.patterns} />
        <div>
          <div className="eyebrow mb-1.5">1 · Pick an option</div>
          <div className="grid gap-1.5">
            {c.options.map((o, i) => (
              <button
                key={i}
                disabled={compared}
                onClick={() => {
                  setChoice(i);
                  persist(i, text);
                }}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition',
                  choice === i ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/60',
                  compared && i === c.recommended && 'ring-2 ring-ok/60',
                )}
              >
                <div className="flex items-center gap-2 font-mono text-[13px] font-semibold">
                  <span className={cn('grid h-4 w-4 place-items-center rounded-full border', choice === i ? 'border-accent bg-accent' : 'border-line')}>
                    {choice === i && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  {o.name}
                  {compared && i === c.recommended && (
                    <Tag size="sm" tone="ok">
                      expert pick
                    </Tag>
                  )}
                </div>
                <div className="mt-0.5 pl-6 text-[12px] leading-relaxed text-muted">
                  <Rich text={o.summary} />
                </div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="eyebrow mb-1.5 flex items-center justify-between">
            <span>2 · Write your reasoning</span>
            <span className={cn('normal-case tracking-normal', written >= MIN_CHARS ? 'text-ok' : 'text-faint')}>
              {written}/{MIN_CHARS}+ chars
            </span>
          </div>
          <textarea
            value={text}
            disabled={compared}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => persist(choice, text)}
            rows={9}
            spellCheck
            className="w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none focus:border-accent disabled:opacity-80"
          />
          <p className="mt-1 text-[11.5px] text-faint">
            Write it as you would for your team: name the tradeoffs you're accepting and what would make you change your mind. Explaining it yourself is what makes it stick.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!compared ? (
            <Button variant="primary" size="sm" icon={<Scale size={14} />} disabled={choice === null || written < MIN_CHARS} onClick={compare}>
              Compare with expert
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                setCompared(false);
                setSelfTicked({});
              }}
            >
              Revise my ADR
            </Button>
          )}
          {best !== undefined && <span className="font-mono text-[11px] text-faint">best {best}%</span>}
        </div>
      </section>

      <section className="min-w-0 space-y-3 lg:pt-7">
        {!compared ? (
          <div className="rounded-xl border border-dashed border-line p-5 text-[13px] text-muted">
            <FileText size={18} className="mb-2 text-faint" />
            The expert ADR stays hidden until you commit to your own answer. Committing first, even if you're unsure, makes the comparison stick.
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">How your ADR compares</span>
              <span className={cn('font-mono text-xl font-semibold', score >= 80 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-bad')}>{score}%</span>
            </div>
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-1.5 text-[12px] text-muted">
                Option: {choice === c.recommended ? <span className="font-semibold text-ok">same as the expert</span> : <span className="font-semibold text-warn">different from the expert</span>} ·
                considerations a strong answer covers:
              </div>
              <ul className="space-y-1.5">
                {c.considerations.map((k, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px]">
                    {auto[i] ? (
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ok" />
                    ) : (
                      <button title="I did cover this (in other words): half credit" onClick={() => toggleSelf(i)} className="mt-0.5 shrink-0">
                        {selfTicked[i] ? <CheckCircle2 size={15} className="text-warn" /> : <CircleDashed size={15} className="text-faint hover:text-warn" />}
                      </button>
                    )}
                    <span>
                      <span className="font-semibold">{k.label}</span>
                      {!auto[i] && <span className="text-faint"> {selfTicked[i] ? '(self-assessed)' : '(missed? tick if you said it differently)'}</span>}
                      <span className="block text-muted">
                        <Rich text={k.why} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-ok/40 bg-ok/[0.04] p-3.5">
              <div className="eyebrow mb-1 text-ok">Expert ADR</div>
              <p className="font-mono text-[13px] font-semibold leading-snug">
                <Rich text={c.expert.decision} />
              </p>
              <div className="mt-2 text-[12px] font-semibold">Because</div>
              <ul className="ml-4 list-disc space-y-0.5 text-[12.5px] leading-relaxed text-muted">
                {c.expert.rationale.map((r, i) => (
                  <li key={i}>
                    <Rich text={r} />
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[12px] font-semibold">We accept</div>
              <ul className="ml-4 list-disc space-y-0.5 text-[12.5px] leading-relaxed text-muted">
                {c.expert.consequences.map((r, i) => (
                  <li key={i}>
                    <Rich text={r} />
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-[12px] font-semibold">Revisit when</div>
              <p className="text-[12.5px] leading-relaxed text-muted">
                <Rich text={c.expert.revisitWhen} />
              </p>
            </div>
            <Callout tone="tip" title="Reflect">
              <span className="text-[12.5px]">What did the expert weigh that you didn't? Write one sentence in your ADR that you'll remember for the next interview, then revise.</span>
            </Callout>
          </>
        )}
      </section>
    </div>
  );
}

export function Adr() {
  const { id } = useParams();
  const c = ADRS.find((x) => x.id === id);
  if (!c)
    return (
      <div className="p-10 text-center">
        <p className="font-mono">Unknown decision.</p>
        <Link to="/de-system-design/practice" className="text-accent underline">
          Back to drills
        </Link>
      </div>
    );
  return <AdrDrill key={c.id} c={c} />;
}
