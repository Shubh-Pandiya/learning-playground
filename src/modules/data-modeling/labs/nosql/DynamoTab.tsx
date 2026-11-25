import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { ArrowRight, Flame, Layers } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tag, Tooltip } from '@/shared/ui';
import type { LabTopic } from '../../types';
import { Rich } from '../../ui/Rich';
import { DYNAMO_STEPS, ENTITY_OPTS, GSI_OPTS, PATTERNS, UNDER_HOOD } from './data';
import {
  KIND_LABEL,
  KIND_SHORT,
  N_PARTS,
  TABLE_NAME,
  diffDynamo,
  dynamoAllQuery,
  dynamoGsiShard,
  entityOpt,
  evalDynamo,
  fmt,
  fmtBytes,
  gsiOpt,
  indexLabel,
  isGsi,
  keyNames,
  keyText,
  materialize,
  optLabel,
  partitionOf,
  traceSample,
  type DDesign,
  type DEval,
  type Entity,
  type Kind,
  type PatternEval,
  type PatternId,
  type Row,
  type Step,
  type Verdict,
} from './engine';
import { Exercises, FrozenBadge, History, LatestChange, Metric, OptionGroup, RedFlags, Walkthrough, useExercise, useLab } from './common';

const ENT: Record<Entity, { dot: string; text: string; box: string; name: string }> = {
  customer: { dot: 'bg-info', text: 'text-info', box: 'border-info/30 bg-info/[0.06]', name: 'customer' },
  order: { dot: 'bg-accent', text: 'text-accent', box: 'border-accent/30 bg-accent/[0.06]', name: 'order' },
  item: { dot: 'bg-violet', text: 'text-violet', box: 'border-violet/30 bg-violet/[0.06]', name: 'order item' },
};

const KIND_TONE: Record<Kind, 'ok' | 'info' | 'warn' | 'bad'> = { query: 'ok', gsi: 'info', batch: 'warn', scan: 'bad' };
const toneOf = (p: PatternEval) => (p.kind === 'scan' ? 'bad' : p.ok ? KIND_TONE[p.kind] : 'warn');
const pillOf = (p: PatternEval) => (p.label?.includes('Scan-equivalent') ? 'Scan-like Query' : p.ok ? KIND_SHORT[p.kind] : p.kind === 'batch' || p.kind === 'scan' ? KIND_SHORT[p.kind] : `${KIND_SHORT[p.kind]} + app sort`);
const OP: Record<Step['op'], string> = { get: 'GetItem', query: 'Query', scan: 'Scan', batch: 'BatchGetItem' };
const VERDICT_TEXT: Record<Verdict, string> = { good: 'text-ok', meh: 'text-warn', trap: 'text-bad' };
const SEQ = ['', '①', '②', '③'];
const rcuText = (r: number) => (r <= 10 ? 'text-ok' : r <= 1000 ? 'text-warn' : 'text-bad');
const slotOf = (index: string) => index.split('.')[1] ?? 'base';
const hexRange = (c: number) => {
  const w = 256 / N_PARTS;
  const h = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return `${h(c * w)}–${h(c * w + w - 1)}`;
};

type Trace = ReturnType<typeof traceSample>;

export default function DynamoTab({ topic, active }: { topic: LabTopic; active: boolean }) {
  const lab = useLab<DDesign, DEval>({ topic, tab: 'dynamo', steps: DYNAMO_STEPS, evaluate: evalDynamo, diff: diffDynamo });
  const { state: d, ev, revealed, st } = lab;
  const [sel, setSel] = useState<PatternId>('a2');
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (revealed && st.focus) setSel(st.focus as PatternId);
    setRun((r) => r + 1);
  }, [lab.step, revealed, st.focus]);
  useEffect(() => setRun((r) => r + 1), [d]);

  const rows = useMemo(() => materialize(ev.pl), [ev]);
  const p = ev.patterns[sel];
  const trace = useMemo(() => traceSample(p.steps, rows), [p, rows]);

  const byUser = lab.source === 'user';
  const allQuery = dynamoAllQuery(ev);
  const shard = dynamoGsiShard(d, ev);
  useExercise(topic, 'dynamo-all-query', allQuery, byUser);
  useExercise(topic, 'dynamo-gsi-shard', shard, byUser);

  const pick = (slot: keyof DDesign, id: string) => {
    const label = slot === 'gsi1' || slot === 'gsi2' ? gsiOpt(id).label : `${entityOpt(id).entity}: ${optLabel(entityOpt(id))}`;
    lab.change({ ...d, [slot]: id }, `${slot.toUpperCase().startsWith('GSI') ? slot.toUpperCase() : 'Key'} → ${label}`);
  };

  const nGood = Object.values(ev.patterns).filter((x) => x.ok && (x.kind === 'query' || x.kind === 'gsi')).length;
  const nScan = Object.values(ev.patterns).filter((x) => x.kind === 'scan').length;
  const rcuSec = Object.values(ev.patterns).reduce((s, x) => s + x.rcuPerSec, 0);
  const hotN = ev.hot.filter((h) => h.level === 'hot').length;
  const flags = [
    ...(['customer', 'order', 'item'] as const).map((k) => entityOpt(d[k])).filter((o) => o.verdict === 'trap').map((o) => ({ title: `${ENT[o.entity].name}: \`${optLabel(o)}\``, why: o.why, fix: o.fix })),
    ...(['gsi1', 'gsi2'] as const).map((k) => gsiOpt(d[k])).filter((g) => g.verdict === 'trap').map((g) => ({ title: `\`${g.label}\``, why: g.why, fix: g.fix })),
  ];
  const locked = !revealed;

  return (
    <div className="flex h-full min-h-0">
      <Walkthrough steps={DYNAMO_STEPS} stepper={lab.stepper} answers={lab.answers} onAnswer={lab.answer} stepChange={lab.stepChange} active={active} notes={UNDER_HOOD.dynamo} />

      <main className="relative min-w-0 flex-1 overflow-y-auto bg-sunken/60 bg-grid">
        <FrozenBadge show={!revealed} />
        <div className="space-y-4 p-4">
          <section>
            <div className="mb-1.5 flex items-baseline justify-between">
              <div className="eyebrow">1 · Access patterns (written down first) · click one to send it</div>
              <span className="font-mono text-[10.5px] text-faint">{nGood}/5 are one cheap Query</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PATTERNS.map((pat) => {
                const x = ev.patterns[pat.id];
                const on = pat.id === sel;
                return (
                  <button
                    key={pat.id}
                    onClick={() => {
                      setSel(pat.id);
                      setRun((r) => r + 1);
                    }}
                    className={cn('rounded-xl border bg-surface p-2 text-left transition-all', on ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-ink/30')}
                  >
                    <div className="font-mono text-[10px] font-semibold text-faint">{pat.short}</div>
                    <div className="mt-0.5 min-h-[30px] text-[11.5px] leading-snug text-ink">{pat.name}</div>
                    <motion.div key={`${x.kind}${x.ok}`} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-1">
                      <Tag size="sm" tone={toneOf(x)}>
                        {pillOf(x)}
                      </Tag>
                    </motion.div>
                    <div className="mt-1 font-mono text-[10px] leading-relaxed text-muted">
                      <div>
                        <span className={cn('font-semibold', rcuText(x.rcu))}>{fmt(x.rcu)}</span> RCU/call · {fmt(x.calls)} call{x.calls > 1 ? 's' : ''}
                      </div>
                      <div className="text-faint">
                        {fmt(pat.rate)}/s → {fmt(x.rcuPerSec)} RCU/s
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <RequestPanel p={p} run={run} />

          <section>
            <div className="mb-1.5 flex items-baseline justify-between">
              <div className="eyebrow">2 · Physical layout: partitions by hash(PK) · item collections sorted by SK</div>
              <Legend />
            </div>
            <LayoutGroup>
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {ev.indexes.map((ix) => (
                    <IndexBlock key={ix} index={ix} rows={rows.filter((r) => r.index === ix)} ev={ev} trace={trace} run={run} />
                  ))}
                </AnimatePresence>
              </div>
            </LayoutGroup>
          </section>
        </div>
      </main>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-paper">
        <LatestChange changes={lab.changes} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <section className="space-y-3">
            <div className="eyebrow">Key design</div>
            {(['customer', 'order', 'item'] as const).map((k) => {
              const cur = entityOpt(d[k]);
              return (
                <div key={k}>
                  <OptionGroup
                    title={`${ENT[k].name[0].toUpperCase()}${ENT[k].name.slice(1)}`}
                    value={d[k]}
                    locked={locked}
                    onPick={(id) => pick(k, id)}
                    options={ENTITY_OPTS.filter((o) => o.entity === k).map((o) => ({
                      id: o.id,
                      label: optLabel(o),
                      sub: o.table === 'app' ? (o.viaHeaderList ? 'app_table · ids listed on the order' : 'app_table (single table)') : `own table: ${TABLE_NAME[o.table]}${o.viaHeaderList ? ' · ids listed on the order' : ''}`,
                    }))}
                  />
                  <p className={cn('mt-1 text-[11px] leading-snug', VERDICT_TEXT[cur.verdict])}>
                    <Rich text={cur.why} />
                  </p>
                </div>
              );
            })}
            {(['gsi1', 'gsi2'] as const).map((k) => {
              const cur = gsiOpt(d[k]);
              return (
                <div key={k}>
                  <OptionGroup
                    title={k === 'gsi1' ? 'GSI1 · orders by status' : 'GSI2 · order by id'}
                    value={d[k]}
                    locked={locked}
                    onPick={(id) => pick(k, id)}
                    options={GSI_OPTS.filter((g) => g.slot === k).map((g) => ({ id: g.id, label: g.label }))}
                  />
                  <p className={cn('mt-1 text-[11px] leading-snug', VERDICT_TEXT[cur.verdict])}>
                    <Rich text={cur.why} />
                  </p>
                </div>
              );
            })}
            <p className="text-[10.5px] text-faint">GSIs are built on the table that holds the orders.</p>
          </section>

          <RedFlags flags={flags} />

          <section>
            <div className="eyebrow mb-1.5">Production estimate · 1M customers · 600 orders/s</div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Served by 1 Query" value={`${nGood} / 5`} tone={nGood === 5 ? 'ok' : nGood >= 3 ? 'warn' : 'bad'} sub={`${nScan} Scan${nScan === 1 ? '' : 's'}`} />
              <Metric label="Read load" value={`${fmt(rcuSec)} RCU/s`} tone={rcuSec < 50_000 ? 'ok' : rcuSec < 1e6 ? 'warn' : 'bad'} sub="all 5 patterns at peak" />
              <Metric label="Hot partitions" value={hotN} tone={hotN ? 'bad' : ev.hot.length ? 'warn' : 'ok'} sub={ev.hot[0] ? `${ev.hot[0].pk}: ${fmt(ev.hot[0].wcu)} WCU` : 'no key over 60% of a partition'} />
              <Metric label="WCU per order life" value={ev.wcuPerOrder} sub="create + 3 status changes, incl. GSI copies" />
            </div>
            {ev.big.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-snug text-warn">
                Largest item collection: <code className="font-mono">{ev.big[0].pk}</code> ≈ {fmtBytes(ev.big[0].bytes)}
              </p>
            )}
          </section>

          <Exercises
            topic={topic}
            items={[
              { id: 'dynamo-all-query', hint: 'Every card needs a green or blue pill (no Scan, no 2-call join, no app sort) and no hot key. You need item collections **and** two GSIs.', status: `now: ${nGood}/5 single Queries · ${hotN} hot key${hotN === 1 ? '' : 's'}` },
              { id: 'dynamo-gsi-shard', hint: 'Keep A4 on a GSI, but spread `STATUS#PENDING` over several keys.', status: `GSI1 now: ${gsiOpt(d.gsi1).label}` },
            ]}
          />
          <History changes={lab.changes} />
        </div>
      </aside>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10px] text-muted">
      {(['customer', 'order', 'item'] as const).map((e) => (
        <span key={e} className="flex items-center gap-1">
          <span className={cn('h-2 w-2 rounded-full', ENT[e].dot)} />
          {ENT[e].name}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="h-2 w-3 rounded-sm bg-ok/40 ring-1 ring-ok" /> returned
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2 w-3 rounded-sm bg-warn/30 ring-1 ring-warn" /> read + thrown away
      </span>
      <span className="flex items-center gap-1">
        <Flame size={11} className="text-bad" /> hot key
      </span>
    </div>
  );
}

function RequestPanel({ p, run }: { p: PatternEval; run: number }) {
  const pat = PATTERNS.find((x) => x.id === p.id)!;
  const seqs = [...new Set(p.steps.map((s) => s.seq))];
  const tone = toneOf(p);
  return (
    <section className={cn('rounded-xl border bg-surface p-3', tone === 'bad' ? 'border-bad/40' : tone === 'warn' ? 'border-warn/40' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-semibold text-ink">{pat.short}</span>
        <span className="text-[12px] text-muted">· sample: {pat.ask}</span>
        <Tag size="sm" tone={tone} variant="solid" className="ml-auto">
          {p.label ?? KIND_LABEL[p.kind]}
        </Tag>
      </div>
      <div key={run} className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        <span className="rounded-md border border-line bg-sunken px-2 py-1 text-muted">app</span>
        {seqs.map((q, i) => {
          const ss = p.steps.filter((s) => s.seq === q);
          return (
            <motion.span key={q} className="flex items-center gap-1.5" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.7 }}>
              <ArrowRight size={12} className={i ? 'text-faint' : 'text-accent'} />
              {i > 0 && <span className="text-[10px] text-faint">then</span>}
              {ss.map((s, j) => (
                <span key={j} className={cn('rounded-md border px-2 py-1', s.op === 'scan' ? 'border-bad/50 bg-bad/10 text-bad' : isGsi(s.index) ? 'border-info/50 bg-info/10 text-info' : 'border-ok/50 bg-ok/10 text-ok')}>
                  {SEQ[q]} {OP[s.op]} {indexLabel(s.index)}
                  {s.pks && s.pks.length > 1 ? ` ×${s.pks.length}` : ''}
                </span>
              ))}
            </motion.span>
          );
        })}
        <span className="ml-auto text-[10.5px] text-faint">
          {fmt(p.calls)} request{p.calls > 1 ? 's' : ''} · {fmt(p.items)} items read · {fmtBytes(p.bytes)} · <b className={rcuText(p.rcu)}>{fmt(p.rcu)} RCU</b>
        </span>
      </div>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-sunken px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink">
        {p.how.map((l) => (l === '+ then' ? '-- then, with the result:' : l)).join('\n')}
      </pre>
      <p className="mt-1.5 text-[12px] leading-snug text-muted">
        <Rich text={p.note} />
      </p>
    </section>
  );
}

function IndexBlock({ index, rows, ev, trace, run }: { index: string; rows: Row[]; ev: DEval; trace: Trace; run: number }) {
  const gsi = isGsi(index);
  const names = keyNames(index);
  const pls = ev.pl.filter((x) => x.index === index);
  const hot = ev.hot.filter((h) => h.index === index);
  const unseen = hot.filter((h) => !rows.some((r) => r.pk === h.pk));
  const cols = Array.from({ length: N_PARTS }, (_, c) => {
    const pks = [...new Set(rows.filter((r) => partitionOf(r.pk) === c).map((r) => r.pk))].sort();
    let peak: { pk: string; frac: number; wcu: number; rcu: number } | null = null;
    for (const [k, h] of Object.entries(ev.heat)) {
      const [ix, pk] = k.split('|');
      if (ix !== index || partitionOf(pk) !== c) continue;
      const frac = Math.max(h.wcu / 1000, h.rcu / 3000);
      if (!peak || frac > peak.frac) peak = { pk, frac, wcu: h.wcu, rcu: h.rcu };
    }
    return { c, pks, peak, seq: trace.parts.get(`${index}|${c}`) };
  });

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} className={cn('rounded-xl border bg-surface/90 p-2.5', gsi ? 'border-dashed border-info/50' : 'border-line')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Layers size={13} className={gsi ? 'text-info' : 'text-ink'} />
        <span className="font-mono text-[12px] font-semibold text-ink">{indexLabel(index)}</span>
        {gsi ? (
          <Tag size="sm" tone="info">
            async copy · eventually consistent
          </Tag>
        ) : (
          <Tag size="sm">base table</Tag>
        )}
        <span className="ml-auto font-mono text-[10px] text-faint">
          {pls.map((x) => `${ENT[x.entity].name}: ${names.pk}=${keyText(x.pk)}${x.sk ? ` ${names.sk}=${keyText(x.sk)}` : ''}`).join('  ·  ')}
        </span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${N_PARTS}, minmax(0, 1fr))` }}>
        {cols.map(({ c, pks, peak, seq }) => {
          const level = !peak ? 'none' : peak.frac > 1 ? 'hot' : peak.frac >= 0.6 ? 'warm' : 'cool';
          return (
            <div
              key={c}
              className={cn(
                'relative min-w-0 rounded-lg border p-1.5 transition-colors duration-500',
                level === 'hot' ? 'border-bad/70 bg-bad/[0.07] shadow-[0_0_18px_rgb(var(--c-bad)/0.35)]' : seq ? 'border-accent/50 bg-accent/[0.04]' : 'border-line bg-paper/60',
              )}
            >
              <div className="flex items-center justify-between font-mono text-[9.5px] text-faint">
                <span>
                  P{c} · hash {hexRange(c)}
                </span>
                <AnimatePresence>
                  {seq !== undefined && (
                    <motion.span
                      key={`${run}-${seq}`}
                      initial={{ y: -14, opacity: 0, scale: 0.6 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ delay: (seq - 1) * 0.7 + 0.15, type: 'spring', stiffness: 400, damping: 18 }}
                      className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-paper"
                    >
                      {SEQ[seq]} req
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <HeatMeter peak={peak} />
              <div className="mt-1.5 space-y-1.5">
                {pks.length === 0 && <div className="py-2 text-center font-mono text-[9.5px] text-faint">no sample keys</div>}
                {pks.map((pk) => (
                  <Collection key={pk} pk={pk} index={index} rows={rows.filter((r) => r.pk === pk).sort((a, b) => a.sk.localeCompare(b.sk))} hot={hot.find((h) => h.pk === pk)} big={ev.big.find((b) => b.index === index && b.pk === pk)} trace={trace} run={run} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {unseen.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[10px]">
          <span className="text-faint">also on this index (not in the sample):</span>
          {unseen.map((h) => (
            <span key={h.pk} className={cn('rounded border px-1', h.level === 'hot' ? 'border-bad/50 text-bad' : 'border-warn/50 text-warn')}>
              {h.pk} → P{partitionOf(h.pk)} · {fmt(h.wcu)} WCU/s
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function HeatMeter({ peak }: { peak: { pk: string; frac: number; wcu: number; rcu: number } | null }) {
  if (!peak)
    return (
      <Tooltip content="Every key here is one customer or one order: load is spread over millions of keys.">
        <div className="mt-1 h-1 rounded-full bg-ok/25" />
      </Tooltip>
    );
  const tone = peak.frac > 1 ? 'bg-bad' : peak.frac >= 0.6 ? 'bg-warn' : 'bg-ok';
  const byW = peak.wcu / 1000 >= peak.rcu / 3000;
  return (
    <Tooltip content={`Hottest key ${peak.pk}: ${fmt(peak.wcu)} WCU/s of 1,000 · ${fmt(peak.rcu)} RCU/s of 3,000`}>
      <div className="mt-1">
        <div className="relative h-1 overflow-hidden rounded-full bg-sunken">
          <motion.div className={cn('h-full rounded-full', tone)} initial={false} animate={{ width: `${Math.min(100, peak.frac * 100)}%` }} transition={{ duration: 0.6 }} />
        </div>
        <div className={cn('mt-0.5 font-mono text-[9px]', peak.frac > 1 ? 'font-semibold text-bad' : 'text-faint')}>
          {byW ? `${fmt(peak.wcu)} / 1,000 WCU` : `${fmt(peak.rcu)} / 3,000 RCU`}
        </div>
      </div>
    </Tooltip>
  );
}

function Collection({ pk, index, rows, hot, big, trace, run }: { pk: string; index: string; rows: Row[]; hot?: DEval['hot'][number]; big?: DEval['big'][number]; trace: Trace; run: number }) {
  const names = keyNames(index);
  return (
    <motion.div
      layout
      className={cn('relative rounded-md border bg-surface p-1', hot?.level === 'hot' ? 'border-bad shadow-[0_0_14px_rgb(var(--c-bad)/0.45)]' : hot ? 'border-warn' : 'border-line')}
    >
      {hot?.level === 'hot' && <span className="pointer-events-none absolute -inset-px animate-pulse-soft rounded-md ring-2 ring-bad/60" />}
      <div className="flex items-center gap-1 px-0.5 pb-0.5">
        {hot && <Flame size={10} className={hot.level === 'hot' ? 'shrink-0 text-bad' : 'shrink-0 text-warn'} />}
        <span className="truncate font-mono text-[10px] font-semibold text-ink" title={`${names.pk} = ${pk}`}>
          {pk}
        </span>
        {big && (
          <span className="ml-auto shrink-0 rounded bg-warn/15 px-1 font-mono text-[8.5px] text-warn" title="Production size of this item collection">
            ≈{fmtBytes(big.bytes)}
          </span>
        )}
      </div>
      {hot && <div className={cn('px-0.5 pb-0.5 font-mono text-[9px] leading-tight', hot.level === 'hot' ? 'text-bad' : 'text-warn')}>{hot.why}</div>}
      <div className="space-y-px">
        {rows.map((r) => {
          const t = trace.read.get(r.key);
          return (
            <motion.div key={r.key} layout layoutId={`${slotOf(index)}:${r.id}`} transition={{ type: 'spring', stiffness: 320, damping: 30 }} className={cn('relative flex items-center gap-1 rounded border px-1 py-[2px]', ENT[r.entity].box)}>
              {t && (
                <motion.span
                  key={run}
                  className={cn('pointer-events-none absolute inset-0 rounded ring-1', t.kept ? 'bg-ok/25 ring-ok' : 'bg-warn/20 ring-warn/70')}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0.85] }}
                  transition={{ delay: (t.seq - 1) * 0.7 + 0.45 + Math.min(t.order, 12) * 0.07, duration: 0.5 }}
                />
              )}
              <span className={cn('relative h-1.5 w-1.5 shrink-0 rounded-full', ENT[r.entity].dot)} />
              <span className="relative min-w-0 flex-1 truncate font-mono text-[9.5px] text-ink" title={`${names.sk} = ${r.sk || '(none)'}`}>
                {r.sk || <span className="text-faint">no SK</span>}
              </span>
              <span className={cn('relative shrink-0 font-mono text-[9px]', ENT[r.entity].text)}>{r.label}</span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
