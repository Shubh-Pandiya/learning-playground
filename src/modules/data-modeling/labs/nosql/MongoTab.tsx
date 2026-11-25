import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Database, FileText, PenLine, UserRound } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Tag } from '@/shared/ui';
import type { LabTopic } from '../../types';
import { Rich } from '../../ui/Rich';
import { MONGO_STEPS, UNDER_HOOD } from './data';
import { AUTHOR_OPTS, COMMENT_OPTS, MONGO, diffMongo, docEmbedOk, evalMongo, fmt, fmtBytes, type MEval, type MState, type Verdict } from './engine';
import { Exercises, FrozenBadge, History, LatestChange, LogSlider, Metric, OptionGroup, RedFlags, Walkthrough, useExercise, useLab } from './common';

const VERDICT_TEXT: Record<Verdict, string> = { good: 'text-ok', meh: 'text-warn', trap: 'text-bad' };
const SEQ = ['①', '②', '③'];
const COLL_ICON = { posts: FileText, users: UserRound, comments: Database };
const NAMES = ['maria', 'kenji', 'olu', 'priya', 'tom', 'ines', 'yusuf', 'lea'];
const TEXTS = ['Great write-up!', 'What about sharding?', 'This saved my week', '+1, same issue', 'Benchmarks?', 'Typo in step 3', 'Thanks 🙏', 'Disagree on ORMs'];

/** Bar position on a log axis 1 KB … 32 MB. */
const logPos = (b: number) => Math.max(0, Math.min(1, (Math.log10(Math.max(1024, b)) - 3.0103) / (Math.log10(32 * 1024 ** 2) - 3.0103)));

export default function MongoTab({ topic, active }: { topic: LabTopic; active: boolean }) {
  const lab = useLab<MState, MEval>({ topic, tab: 'mongo', steps: MONGO_STEPS, evaluate: evalMongo, diff: diffMongo });
  const { state: s, ev, revealed } = lab;
  const [run, setRun] = useState(0);
  useEffect(() => setRun((r) => r + 1), [s.author, s.comments, lab.step]);

  const solved = docEmbedOk(s);
  useExercise(topic, 'doc-embed', solved, lab.source === 'user');
  const stress = evalMongo({ ...s, count: MONGO.stress });

  const au = AUTHOR_OPTS.find((o) => o.id === s.author)!;
  const co = COMMENT_OPTS.find((o) => o.id === s.comments)!;
  const flags = co.verdict === 'trap' ? [{ title: `\`${co.label}\``, why: co.why, fix: co.fix }] : [];
  if (ev.fails) flags.unshift({ title: 'Document over 16 MB', why: `The post would be **${fmtBytes(ev.docBytes)}**: MongoDB rejects the write (\`BSONObjectTooLarge\`). Comments past ~${fmt(ev.maxComments)} cannot be stored.`, fix: co.fix });
  const locked = !revealed;
  const pct = (ev.docBytes / MONGO.limit) * 100;

  return (
    <div className="flex h-full min-h-0">
      <Walkthrough steps={MONGO_STEPS} stepper={lab.stepper} answers={lab.answers} onAnswer={lab.answer} stepChange={lab.stepChange} active={active} notes={UNDER_HOOD.mongo} />

      <main className="relative min-w-0 flex-1 overflow-y-auto bg-sunken/60 bg-grid">
        <FrozenBadge show={!revealed} />
        <div className="space-y-4 p-4">
          <section className="rounded-xl border border-line bg-surface p-3">
            <div className="eyebrow mb-1">Access pattern: render a post page</div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
              Post + author name/avatar + latest 10 comments + comment count.
              <Tag size="sm" variant="solid" tone={ev.reads.length <= 1 ? 'ok' : ev.reads.length === 2 ? 'info' : 'warn'} className="ml-auto">
                {ev.reads.length} read{ev.reads.length > 1 ? 's' : ''} per page view
              </Tag>
            </div>
            <div className="mt-3">
              <LogSlider label="comments on this post" value={s.count} min={1} max={100_000} format={(v) => fmt(v)} disabled={locked} onChange={(v) => lab.change({ ...s, count: v }, 'Comments per post', true)} />
            </div>
          </section>

          <PageView ev={ev} run={run} />

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <PostDoc s={s} ev={ev} />
            <div className="space-y-3">
              <UsersColl s={s} ev={ev} />
              <CommentsColl s={s} ev={ev} />
            </div>
          </div>

          <section className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-baseline justify-between">
              <div className="eyebrow mb-1.5">Post document size vs the 16 MB BSON limit (log scale)</div>
              <span className={cn('font-mono text-[12px] font-semibold', ev.fails ? 'text-bad' : ev.status === 'warn' ? 'text-warn' : 'text-ok')}>
                {fmtBytes(ev.docBytes)} · {pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}%
              </span>
            </div>
            <div className="relative h-4 rounded-full bg-sunken">
              <motion.div
                className={cn('absolute inset-y-0 left-0 rounded-full', ev.fails ? 'bg-bad' : ev.status === 'warn' ? 'bg-warn' : 'bg-ok')}
                initial={false}
                animate={{ width: `${logPos(ev.docBytes) * 100}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
              {[
                { b: 10 * 1024, t: '10 KB' },
                { b: 100 * 1024, t: '100 KB' },
                { b: MONGO.safe, t: '1 MB safe' },
                { b: MONGO.limit, t: '16 MB limit' },
              ].map((m) => (
                <div key={m.t} className="absolute inset-y-[-3px]" style={{ left: `${logPos(m.b) * 100}%` }}>
                  <div className={cn('h-[22px] w-px', m.b === MONGO.limit ? 'bg-bad' : 'bg-ink/30')} />
                  <div className={cn('-translate-x-1/2 whitespace-nowrap font-mono text-[9px]', m.b === MONGO.limit ? 'text-bad' : 'text-faint')}>{m.t}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[11.5px] leading-snug text-muted">
              {s.comments === 'embed'
                ? `Embedded array: grows ~${fmtBytes(MONGO.comment)} per comment, forever. Fails at ~${fmt(ev.maxComments)} comments; every \`$push\` rewrites the whole document long before that.`
                : s.comments === 'subset'
                  ? 'Only the latest 10 are embedded (`$slice: -10`): the post size stops growing after 10 comments.'
                  : 'No comments inside: the post size is independent of the comment count.'}
            </p>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <WritePanel title="Someone posts a comment" icon={PenLine} ev={ev} />
            <RenamePanel s={s} ev={ev} run={run} />
          </div>
        </div>
      </main>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-paper">
        <LatestChange changes={lab.changes} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <section className="space-y-3">
            <div className="eyebrow">Embed or reference?</div>
            <div>
              <OptionGroup title="Author (1 per post, shared by 300 posts)" value={s.author} locked={locked} onPick={(id) => lab.change({ ...s, author: id as MState['author'] }, `Author → ${AUTHOR_OPTS.find((o) => o.id === id)!.label}`)} options={AUTHOR_OPTS.map((o) => ({ id: o.id, label: o.label }))} />
              <p className={cn('mt-1 text-[11px] leading-snug', VERDICT_TEXT[au.verdict])}>
                <Rich text={au.why} />
              </p>
            </div>
            <div>
              <OptionGroup title="Comments (unbounded)" value={s.comments} locked={locked} onPick={(id) => lab.change({ ...s, comments: id as MState['comments'] }, `Comments → ${COMMENT_OPTS.find((o) => o.id === id)!.label}`)} options={COMMENT_OPTS.map((o) => ({ id: o.id, label: o.label }))} />
              <p className={cn('mt-1 text-[11px] leading-snug', VERDICT_TEXT[co.verdict])}>
                <Rich text={co.why} />
              </p>
            </div>
          </section>

          <RedFlags flags={flags} />

          <section>
            <div className="eyebrow mb-1.5">Metrics</div>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Reads / page view" value={ev.reads.length} tone={ev.reads.length <= 2 ? 'ok' : 'warn'} sub={`${fmtBytes(ev.bytesRead)} loaded`} />
              <Metric label="Post doc size" value={fmtBytes(ev.docBytes)} tone={ev.fails ? 'bad' : ev.status === 'warn' ? 'warn' : 'ok'} sub={ev.fails ? 'over 16 MB: writes fail' : `${pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)}% of 16 MB`} />
              <Metric label="Author rename" value={`${fmt(ev.fanout)} doc${ev.fanout > 1 ? 's' : ''}`} tone={ev.fanout > 1 ? 'warn' : 'ok'} sub={ev.fanout > 1 ? 'updateMany on posts' : 'one users doc'} />
              <Metric label="New comment" value={`${ev.write.ops} write${ev.write.ops > 1 ? 's' : ''}`} tone={ev.write.bytes > MONGO.safe ? 'bad' : ev.write.bytes > 64 * 1024 ? 'warn' : 'ok'} sub={`~${fmtBytes(ev.write.bytes)} rewritten`} />
            </div>
            <div className="mt-2">
              <div className="mb-1 font-mono text-[10.5px] text-muted">Indexes needed</div>
              <ul className="space-y-0.5">
                {ev.indexes.map((i) => (
                  <li key={i} className="font-mono text-[10.5px] leading-snug text-ink">
                    · {i}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <Exercises
            topic={topic}
            items={[
              {
                id: 'doc-embed',
                hint: 'Checked at 50,000 comments: page view ≤ 2 reads and the post ≤ 1 MB (well under 16 MB).',
                status: `at 50k: ${stress.reads.length} read${stress.reads.length > 1 ? 's' : ''} · post ${fmtBytes(stress.docBytes)}`,
              },
            ]}
          />
          <History changes={lab.changes} />
        </div>
      </aside>
    </div>
  );
}

function PageView({ ev, run }: { ev: MEval; run: number }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="eyebrow mb-1.5">Page view: requests in order</div>
      <div key={run} className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        <span className="rounded-md border border-line bg-sunken px-2 py-1 text-muted">GET /posts/:id</span>
        {ev.reads.map((r, i) => (
          <motion.span key={i} className="flex items-center gap-1.5" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.6 }}>
            <ArrowRight size={12} className="text-accent" />
            <span className={cn('rounded-md border px-2 py-1', i === 0 ? 'border-ok/50 bg-ok/10 text-ok' : 'border-warn/50 bg-warn/10 text-warn')}>
              {SEQ[i]} {r.op}
            </span>
          </motion.span>
        ))}
      </div>
      {ev.reads.length > 1 && <p className="mt-1.5 text-[11.5px] text-muted">Each extra read is another round trip (sequential: it needs an id from the post). A <code className="font-mono">$lookup</code> moves the join to the server but still does the extra index lookups.</p>}
    </section>
  );
}

function readBadge(ev: MEval, coll: MEval['reads'][number]['coll']) {
  const i = ev.reads.findIndex((r) => r.coll === coll);
  return i < 0 ? null : (
    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.25 + i * 0.6, type: 'spring', stiffness: 400, damping: 16 }} className="rounded-full bg-accent px-1.5 font-mono text-[10px] font-semibold text-paper">
      {SEQ[i]} read
    </motion.span>
  );
}

function CollHeader({ name, ev, extra }: { name: 'posts' | 'users' | 'comments'; ev: MEval; extra?: string }) {
  const I = COLL_ICON[name];
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <I size={13} className="text-muted" />
      <span className="font-mono text-[12px] font-semibold text-ink">{name}</span>
      {extra && <span className="font-mono text-[10px] text-faint">{extra}</span>}
      <span className="ml-auto">{readBadge(ev, name)}</span>
    </div>
  );
}

function PostDoc({ s, ev }: { s: MState; ev: MEval }) {
  const shown = Math.min(ev.embedded, 6);
  const hidden = ev.embedded - shown;
  // visual height of the embedded array grows with log(count)
  const grow = ev.embedded ? 18 + Math.log10(ev.embedded + 1) * 46 : 0;
  return (
    <section className={cn('rounded-xl border bg-surface p-3 transition-colors', ev.fails ? 'border-bad/60' : 'border-line')}>
      <CollHeader name="posts" ev={ev} extra="one document" />
      <motion.div layout className={cn('rounded-lg border bg-paper p-2 font-mono text-[10.5px] leading-relaxed', ev.fails ? 'border-bad bg-bad/[0.05]' : ev.status === 'warn' ? 'border-warn' : 'border-line')}>
        <div className="text-faint">{'{'}</div>
        <div className="pl-3">
          <span className="text-muted">_id:</span> <span className="text-ink">ObjectId("p42")</span>,
        </div>
        <div className="pl-3">
          <span className="text-muted">title:</span> <span className="text-ink">"Modelling for access patterns"</span>,
        </div>
        <div className="pl-3">
          <span className="text-muted">body:</span> <span className="text-faint">"…6 KB of markdown…"</span>,
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          {s.author === 'embed' ? (
            <motion.div key="snap" layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pl-3">
              <span className="text-muted">author:</span> <span className="rounded bg-info/10 px-1 text-info">{'{ _id: "u7", name: "Ada L.", avatar: "…" }'}</span>,
            </motion.div>
          ) : (
            <motion.div key="ref" layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="pl-3">
              <span className="text-muted">author_id:</span> <span className="rounded bg-warn/10 px-1 text-warn">"u7"</span> <span className="text-faint">→ users</span>,
            </motion.div>
          )}
        </AnimatePresence>
        {s.comments !== 'embed' && (
          <div className="pl-3">
            <span className="text-muted">comment_count:</span> <span className="text-ink">{fmt(s.count)}</span>,
          </div>
        )}
        {s.comments !== 'collection' && (
          <div className="pl-3">
            <span className="text-muted">{s.comments === 'subset' ? 'recent' : 'comments'}:</span> [
            <motion.div layout className={cn('relative my-0.5 ml-2 overflow-hidden rounded border-l-2 pl-2', ev.fails ? 'border-bad bg-bad/[0.06]' : s.comments === 'subset' ? 'border-ok bg-ok/[0.05]' : 'border-violet bg-violet/[0.05]')} animate={{ height: grow }} transition={{ type: 'spring', stiffness: 140, damping: 22 }}>
              {Array.from({ length: shown }, (_, i) => (
                <div key={i} className="truncate text-[10px]">
                  <span className="text-violet">{'{'} by: "{NAMES[i % NAMES.length]}"</span>, <span className="text-muted">text: "{TEXTS[i % TEXTS.length]}"</span> {'}'},
                </div>
              ))}
              {hidden > 0 && <div className={cn('text-[10px] font-semibold', ev.fails ? 'text-bad' : 'text-muted')}>… +{fmt(hidden)} more ({fmtBytes(hidden * MONGO.comment)})</div>}
            </motion.div>
            ]
          </div>
        )}
        <div className="text-faint">{'}'}</div>
      </motion.div>
      {ev.fails && <div className="mt-1.5 font-mono text-[10.5px] font-semibold text-bad">✕ BSONObjectTooLarge: document exceeds 16 MB</div>}
    </section>
  );
}

function UsersColl({ s, ev }: { s: MState; ev: MEval }) {
  return (
    <section className={cn('rounded-xl border bg-surface p-3', s.author === 'ref' ? 'border-line' : 'border-dashed border-line opacity-70')}>
      <CollHeader name="users" ev={ev} />
      <div className="rounded-lg border border-line bg-paper p-2 font-mono text-[10.5px]">
        {'{ '}
        <span className="text-muted">_id:</span> "u7", <span className="text-muted">name:</span> "Ada L.", <span className="text-muted">avatar:</span> "…", <span className="text-faint">bio, settings, …</span>
        {' }'}
      </div>
      <p className="mt-1 text-[11px] text-faint">{s.author === 'ref' ? 'Read on every page view to resolve author_id.' : 'Source of truth; the page never reads it (snapshot in the post).'}</p>
    </section>
  );
}

function CommentsColl({ s, ev }: { s: MState; ev: MEval }) {
  const used = s.comments !== 'embed';
  const cells = 40;
  return (
    <section className={cn('rounded-xl border bg-surface p-3', used ? 'border-line' : 'border-dashed border-line opacity-60')}>
      <CollHeader name="comments" ev={ev} extra={used ? `${fmt(s.count)} docs for this post` : 'unused'} />
      {used ? (
        <>
          <div className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[2px]">
            {Array.from({ length: cells }, (_, i) => {
              const exists = i < Math.min(cells, s.count);
              const latest = exists && i < 10;
              const hit = latest && s.comments === 'collection';
              return <div key={i} className={cn('h-2.5 rounded-[2px]', !exists ? 'bg-sunken' : hit ? 'bg-accent' : latest ? 'bg-ok/50' : 'bg-violet/30')} />;
            })}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted">
            {s.comments === 'collection' ? (
              <>
                Newest 10 read through <code className="font-mono text-ink">{'{ post_id: 1, created_at: -1 }'}</code>: an index range, no sort.
              </>
            ) : (
              <>Full history for "load more"; the page itself uses the 10 copies embedded in the post.</>
            )}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-faint">All comments live inside the post document.</p>
      )}
    </section>
  );
}

function WritePanel({ title, icon: I, ev }: { title: string; icon: typeof PenLine; ev: MEval }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <I size={13} className="text-muted" />
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        <span className={cn('ml-auto font-mono text-[10.5px]', ev.write.bytes > MONGO.safe ? 'text-bad' : 'text-muted')}>~{fmtBytes(ev.write.bytes)} rewritten</span>
      </div>
      <pre className="whitespace-pre-wrap rounded-lg bg-sunken px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink">{ev.write.how.join('\n')}</pre>
      <p className="mt-1 text-[11px] leading-snug text-muted">WiredTiger writes a new version of every document it modifies: cost scales with the document, not the change.</p>
    </section>
  );
}

function RenamePanel({ s, ev, run }: { s: MState; ev: MEval; run: number }) {
  const n = 60;
  const each = ev.fanout / n;
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <UserRound size={13} className="text-muted" />
        <span className="text-[12.5px] font-semibold text-ink">Ada renames herself</span>
        <span className={cn('ml-auto font-mono text-[10.5px]', ev.fanout > 1 ? 'text-warn' : 'text-ok')}>
          {fmt(ev.fanout)} document{ev.fanout > 1 ? 's' : ''}
        </span>
      </div>
      <div key={run} className="grid grid-cols-[repeat(20,minmax(0,1fr))] gap-[2px]">
        {Array.from({ length: n }, (_, i) => {
          const hit = s.author === 'embed' || i === 0;
          return (
            <motion.div
              key={i}
              className={cn('h-2.5 rounded-[2px]', !hit ? 'bg-sunken' : s.author === 'embed' ? 'bg-warn' : 'bg-ok')}
              initial={hit ? { opacity: 0.1, scale: 0.6 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 + i * 0.02, duration: 0.25 }}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">
        {s.author === 'embed' ? (
          <>
            Each cell ≈ {fmt(each)} posts: <code className="font-mono text-ink">{'posts.updateMany({ "author._id": "u7" }, { $set: { "author.name": … } })'}</code>. Rare, so often acceptable.
          </>
        ) : (
          <>
            One <code className="font-mono text-ink">users.updateOne</code>. Paid for with an extra read on every page view.
          </>
        )}
      </p>
    </section>
  );
}
