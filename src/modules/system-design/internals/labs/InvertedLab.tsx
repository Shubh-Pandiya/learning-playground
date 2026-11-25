import { useMemo, useState, type DragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GripVertical, RefreshCw, Wrench } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, Seg, Stat, useTicker } from './kit';

interface Cfg {
  lower: boolean;
  stop: boolean;
  stem: boolean;
}
interface Indexed {
  doc: number;
  terms: string[];
  sig: string;
  searchable: boolean;
  seg: number;
}

const DOCS = [
  'Red running shoes for trail runners',
  'Blue shoes with red laces',
  'Waterproof running jacket in red',
  'The best trail shoes of the year',
  'Kids red rain boots',
  'Lightweight shoes for running a marathon',
];
const STOP = new Set(['the', 'a', 'an', 'and', 'for', 'of', 'in', 'with', 'to']);
const K1 = 1.2;
const B = 0.75;

/** Tiny Porter-flavoured stemmer — enough for running/runners → run, shoes → shoe. */
function stem(w: string): string {
  let x = w;
  if (x.length > 4 && x.endsWith('ies')) x = `${x.slice(0, -3)}y`;
  else if (x.length > 3 && x.endsWith('s') && !x.endsWith('ss')) x = x.slice(0, -1);
  if (x.length > 5 && x.endsWith('ing')) x = x.slice(0, -3);
  else if (x.length > 5 && x.endsWith('er')) x = x.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(x) && !/(ll|ss|zz)$/.test(x)) x = x.slice(0, -1);
  return x;
}

function analyze(text: string, c: Cfg) {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((raw) => {
      const lower = c.lower ? raw.toLowerCase() : raw;
      const dropped = c.stop && STOP.has(lower);
      return { raw, lower, dropped, term: dropped ? '' : c.stem ? stem(lower) : lower };
    });
}
const terms = (text: string, c: Cfg) => analyze(text, c).filter((t) => !t.dropped).map((t) => t.term);
const sigOf = (c: Cfg) => [c.lower && 'lowercase', c.stop && 'stop', c.stem && 'stem'].filter(Boolean).join('+') || 'none';

export default function InvertedLab() {
  const [cfg, setCfg] = useState<Cfg>({ lower: true, stop: true, stem: true });
  const [idx, setIdx] = useState<Indexed[]>([]);
  const [segs, setSegs] = useState(0);
  const [last, setLast] = useState<number | null>(null);
  const [query, setQuery] = useState('red running shoes');
  const [op, setOp] = useState<'AND' | 'OR'>('AND');
  const [auto, setAuto] = useState<'manual' | 'auto'>('manual');
  const [over, setOver] = useState(false);

  const sig = sigOf(cfg);
  const buffered = idx.filter((d) => !d.searchable);

  const add = (doc: number) => {
    if (idx.some((d) => d.doc === doc)) return;
    setIdx([...idx, { doc, terms: terms(DOCS[doc], cfg), sig, searchable: false, seg: 0 }]);
    setLast(doc);
  };
  const refresh = () => {
    if (!buffered.length) return;
    setIdx(idx.map((d) => (d.searchable ? d : { ...d, searchable: true, seg: segs + 1 })));
    setSegs(segs + 1);
  };
  useTicker(auto === 'auto', 1000, refresh);
  const reindex = () => setIdx(idx.map((d) => ({ ...d, terms: terms(DOCS[d.doc], cfg), sig })));
  const reset = () => {
    setIdx([]);
    setSegs(0);
    setLast(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const n = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isInteger(n) && n >= 0 && n < DOCS.length) add(n);
  };

  // term dictionary → postings list (doc id + term frequency), sorted by doc id like Lucene
  const postings = useMemo(() => {
    const m = new Map<string, { doc: number; tf: number; searchable: boolean }[]>();
    for (const d of [...idx].sort((a, b) => a.doc - b.doc)) {
      const tf = new Map<string, number>();
      d.terms.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
      tf.forEach((n, t) => m.set(t, [...(m.get(t) ?? []), { doc: d.doc, tf: n, searchable: d.searchable }]));
    }
    return m;
  }, [idx]);

  const qTerms = [...new Set(terms(query, cfg))];
  const live = idx.filter((d) => d.searchable);
  const N = live.length;
  const avgdl = N ? live.reduce((a, d) => a + d.terms.length, 0) / N : 1;
  const lists = qTerms.map((t) => ({ t, docs: (postings.get(t) ?? []).filter((p) => p.searchable).map((p) => p.doc) }));
  const ordered = op === 'AND' ? [...lists].sort((a, b) => a.docs.length - b.docs.length) : lists;
  const steps: { t: string; docs: number[]; acc: number[] }[] = [];
  let acc: number[] = [];
  ordered.forEach((l, i) => {
    acc = i === 0 ? l.docs : op === 'AND' ? acc.filter((d) => l.docs.includes(d)) : [...new Set([...acc, ...l.docs])].sort((a, b) => a - b);
    steps.push({ t: l.t, docs: l.docs, acc });
  });
  const read = lists.reduce((a, l) => a + l.docs.length, 0);
  const results = acc
    .map((doc) => {
      const d = live.find((x) => x.doc === doc)!;
      const score = qTerms.reduce((s, t) => {
        const tf = d.terms.filter((x) => x === t).length;
        if (!tf) return s;
        const df = lists.find((l) => l.t === t)!.docs.length;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        return s + (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.terms.length) / avgdl));
      }, 0);
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score);
  const maxScore = Math.max(0.01, ...results.map((r) => r.score));
  const stale = idx.filter((d) => d.sig !== sig);
  const used = new Set(qTerms);

  let insight: string;
  if (!idx.length) insight = 'Nothing is indexed yet, so every query returns nothing. Drag documents into the index and watch the analyzer turn text into terms and the terms into postings lists.';
  else if (stale.length) insight = `Analyzer mismatch: ${stale.map((d) => `d${d.doc + 1}`).join(', ')} were indexed with "${stale[0].sig}" but the query is analyzed with "${sig}", so the terms do not line up (the index may hold "running" while the query asks for "run"). Index-time and query-time analyzers must match — changing one means a full reindex (in Elasticsearch: build a new index, then swap the alias).`;
  else if (buffered.length) insight = `${buffered.map((d) => `d${d.doc + 1}`).join(', ')} ${buffered.length > 1 ? 'are' : 'is'} in the in-memory indexing buffer: accepted (and durable in the translog/WAL) but NOT searchable until a refresh writes a new immutable segment. Elasticsearch refreshes every 1 s by default — search is near-real-time, i.e. eventually consistent with writes.`;
  else if (!cfg.lower) insight = 'Lowercasing is off: "Red" and "red" are different terms, and "The" slips past the (lowercase) stopword list. Most "why doesn\'t search find it?" bugs are analyzer bugs.';
  else if (!cfg.stem) insight = 'Stemming is off: "running", "runners" and "run" are three unrelated terms, so recall drops. Stemming trades precision for recall — "university" and "universe" can collapse too.';
  else if (op === 'AND') insight = `AND intersects postings lists, starting from the shortest (rarest term) so the intermediate set stays small; lists are sorted by doc id so intersection is a linear merge (Lucene also uses skip lists). BM25 ranks rarer terms (higher IDF) and shorter docs higher.`;
  else insight = 'OR unions the postings lists: more recall, more results to score. BM25 sums each matched term\'s contribution, so docs matching several terms (and rare terms) float to the top.';
  insight += ` Meanwhile, WHERE text LIKE '%shoe%' has a leading wildcard: a B-tree is sorted by prefix, so it cannot seek and must scan all ${DOCS.length} rows. Postgres's answer is a GIN index over to_tsvector(text) — an inverted index.`;

  const chip = 'rounded border px-1 font-mono text-[10.5px]';
  return (
    <LabFrame
      title="Inverted index: how search engines find documents"
      goal="Drag documents into the index, refresh to make them searchable, then query. Flip analyzer steps and see the terms — and the matches — change."
      onReset={reset}
      controls={
        <>
          <div className="space-y-2">
            <div className="eyebrow">Analyzer</div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['lower', 'lowercase'],
                  ['stop', 'stopwords'],
                  ['stem', 'stemming'],
                ] as [keyof Cfg, string][]
              ).map(([k, label]) => (
                <button key={k} onClick={() => setCfg({ ...cfg, [k]: !cfg[k] })} className={cn('rounded-md border px-2 py-1 font-mono text-[11px]', cfg[k] ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-faint line-through')}>
                  {label}
                </button>
              ))}
            </div>
            <Seg
              label="Refresh interval"
              value={auto}
              options={[
                { value: 'manual', label: 'manual (-1)' },
                { value: 'auto', label: '1 s (default)' },
              ]}
              onChange={setAuto}
            />
          </div>
          <div className="space-y-2">
            <label className="block">
              <div className="eyebrow mb-1">Query</div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px]" />
            </label>
            <Seg label="Operator" value={op} options={[{ value: 'AND', label: 'AND (intersect)' }, { value: 'OR', label: 'OR (union)' }]} onChange={setOp} />
            <div className="font-mono text-[10.5px] text-faint">query terms → {qTerms.map((t) => `"${t}"`).join(' ') || '∅'}</div>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="Full scan LIKE '%x%'" value={`${DOCS.length} docs`} tone="bad" sub="every row read, no ranking" />
          <Stat label="Index read" value={`${read} postings`} tone="ok" sub={`${qTerms.length} term lookups in the dictionary`} />
          <Stat label="Dictionary" value={`${postings.size} terms`} sub={`${[...postings.values()].reduce((a, l) => a + l.length, 0)} postings`} />
          <Stat label="Searchable · buffer" value={`${N} · ${buffered.length}`} tone={buffered.length ? 'warn' : undefined} sub={`${segs} segment${segs === 1 ? '' : 's'} (merged in background)`} />
        </>
      }
      insight={insight}
    >
      <div className="grid gap-2 p-1 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-2">
          <div className="eyebrow mb-1">Unindexed documents — drag into the index →</div>
          <div className="space-y-1">
            {DOCS.map((text, i) =>
              idx.some((d) => d.doc === i) ? null : (
                <div key={i} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))} onDoubleClick={() => add(i)} title="Drag (or double-click) to index" className="flex cursor-grab items-center gap-1.5 rounded-md border border-line bg-paper px-1.5 py-1 text-[12px] active:cursor-grabbing">
                  <GripVertical size={12} className="text-faint" />
                  <span className="font-mono text-[10.5px] text-accent">d{i + 1}</span>
                  {text}
                </div>
              ),
            )}
            {idx.length === DOCS.length && <div className="text-[11.5px] text-faint">All documents indexed.</div>}
          </div>
        </div>
        <div onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop} className={cn('rounded-lg border-2 border-dashed p-2 transition', over ? 'border-accent bg-accent/10' : 'border-line bg-surface/60')}>
          <div className="mb-1 flex items-center justify-between">
            <span className="eyebrow">Index · drop here</span>
            <span className="flex gap-1">
              {stale.length > 0 && (
                <Button size="xs" variant="secondary" icon={<Wrench size={11} />} onClick={reindex}>
                  reindex
                </Button>
              )}
              <Button size="xs" variant={buffered.length ? 'primary' : 'ghost'} icon={<RefreshCw size={11} />} onClick={refresh} disabled={!buffered.length}>
                refresh
              </Button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <AnimatePresence>
              {idx.map((d) => (
                <motion.span key={d.doc} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn(chip, d.searchable ? 'border-ok/50 bg-ok/10 text-ink' : 'border-dashed border-warn text-warn', d.sig !== sig && 'line-through')}>
                  d{d.doc + 1} {d.searchable ? `seg ${d.seg}` : 'buffer'}
                </motion.span>
              ))}
            </AnimatePresence>
            {!idx.length && <span className="text-[11.5px] text-faint">empty — {over ? 'release to index' : 'drag a document card here'}</span>}
          </div>
          {last !== null && (
            <div className="mt-2 space-y-0.5 border-t border-line pt-1.5">
              <div className="font-mono text-[10px] text-faint">analyzer pipeline for d{last + 1} ({sig})</div>
              {(['tokenize', 'lowercase', 'stopwords', 'stem → terms'] as const).map((stage, row) => (
                <div key={stage} className="flex flex-wrap items-center gap-0.5">
                  <span className="w-20 shrink-0 font-mono text-[9.5px] text-faint">{stage}</span>
                  {analyze(DOCS[last], cfg).map((t, i) => {
                    const val = row === 0 ? t.raw : row === 1 ? t.lower : row === 2 ? t.lower : t.term;
                    const gone = row >= 2 && t.dropped;
                    if (row === 3 && gone) return null;
                    const changed = (row === 1 && t.lower !== t.raw) || (row === 3 && t.term !== t.lower);
                    return (
                      <motion.span key={`${last}-${sig}-${row}-${i}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: row * 0.25 + i * 0.03 }} className={cn(chip, gone ? 'border-bad/40 text-bad line-through' : changed ? 'border-info/50 bg-info/10 text-ink' : 'border-line text-muted')}>
                        {val}
                      </motion.span>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-surface p-2">
          <div className="eyebrow mb-1">Term dictionary → postings list [doc·tf]</div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {[...postings.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([t, ps]) => (
                  <motion.div layout key={t} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-1 rounded px-1', used.has(t) && 'bg-accent/10 ring-1 ring-accent/40')}>
                    <span className={cn('w-24 shrink-0 truncate font-mono text-[11px]', used.has(t) ? 'font-semibold text-accent' : 'text-ink')}>{t}</span>
                    <span className="text-faint">→</span>
                    {ps.map((p) => (
                      <motion.span key={p.doc} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4, delay: 0.9 }} className={cn(chip, !p.searchable ? 'border-dashed border-warn text-warn' : p.doc === last ? 'border-accent bg-accent/10 text-ink' : 'border-line text-ink')}>
                        d{p.doc + 1}
                        {p.tf > 1 && <sub>×{p.tf}</sub>}
                      </motion.span>
                    ))}
                  </motion.div>
                ))}
            </AnimatePresence>
            {!postings.size && <div className="text-[11.5px] text-faint">no terms yet</div>}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-2">
          <div className="eyebrow mb-1">Query plan · {op}</div>
          <div className="space-y-0.5 font-mono text-[10.5px]">
            {steps.map((s, i) => (
              <motion.div key={`${s.t}-${i}-${op}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.2 }}>
                <span className="text-faint">{i === 0 ? 'start ' : op === 'AND' ? '∩ ' : '∪ '}</span>
                <span className="text-accent">{s.t}</span> [{s.docs.map((d) => d + 1).join(',')}]{' '}
                <span className="text-faint">=</span> <span className={cn(s.acc.length ? 'text-ink' : 'text-bad')}>[{s.acc.map((d) => d + 1).join(',')}]</span>
              </motion.div>
            ))}
            {!steps.length && <div className="text-faint">query analyzes to no terms</div>}
          </div>
          <div className="mt-2 eyebrow">Ranked by BM25 (k1=1.2, b=0.75)</div>
          <div className="mt-1 space-y-1">
            {results.map((r, i) => (
              <motion.div layout key={r.doc} className="text-[11.5px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    <span className="font-mono text-faint">#{i + 1} d{r.doc + 1}</span> {DOCS[r.doc]}
                  </span>
                  <span className="font-mono text-[10.5px] text-accent">{r.score.toFixed(2)}</span>
                </div>
                <motion.div className="h-1 rounded bg-accent/70" initial={{ width: 0 }} animate={{ width: `${(r.score / maxScore) * 100}%` }} />
              </motion.div>
            ))}
            {!results.length && <div className="text-[11.5px] text-faint">{N ? 'no matching documents' : 'no searchable documents — index and refresh first'}</div>}
          </div>
        </div>
      </div>
    </LabFrame>
  );
}
