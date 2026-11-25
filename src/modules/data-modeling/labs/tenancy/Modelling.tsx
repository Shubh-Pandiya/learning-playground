import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, Play, ShieldCheck, XCircle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button, Callout, CodeBlock } from '@/shared/ui';
import type { Change, ChangeLine } from '../../ui/ChangeCard';
import { Rich } from '../../ui/Rich';
import { KEY_QUESTIONS, RLS_SQL, type KeyQuestion } from './data';

/* ───────────────────────── RLS demo ───────────────────────── */

type Rls = 'off' | 'on' | 'forced';
type Role = 'app_user' | 'owner';
type Tenant = 'acme' | 'globex' | 'initech' | 'unset';

const ROWS: { id: number; tenant: Exclude<Tenant, 'unset'>; name: string }[] = [
  { id: 1, tenant: 'acme', name: 'Website relaunch' },
  { id: 2, tenant: 'globex', name: 'Payroll migration' },
  { id: 3, tenant: 'acme', name: 'Q3 roadmap' },
  { id: 4, tenant: 'initech', name: 'TPS reports' },
  { id: 5, tenant: 'globex', name: 'SOC 2 audit' },
  { id: 6, tenant: 'initech', name: 'Office move' },
];

function rlsResult(rls: Rls, role: Role, tenant: Tenant): { error?: string; visible: number[]; why: string } {
  const all = ROWS.map((r) => r.id);
  if (rls === 'off') return { visible: all, why: 'No policy: the query has no tenant filter, so every tenant’s rows come back.' };
  if (role === 'owner' && rls === 'on') return { visible: all, why: 'The table owner bypasses RLS unless it is FORCEd. Migrations and admin jobs often run as the owner.' };
  if (tenant === 'unset') return { error: 'ERROR:  unrecognized configuration parameter "app.tenant_id"', visible: [], why: 'Fails closed: no tenant in the session, no rows. (With `current_setting(…, true)` it returns NULL and matches nothing.)' };
  return { visible: ROWS.filter((r) => r.tenant === tenant).map((r) => r.id), why: `The policy ANDs \`tenant_id = '${tenant}'\` into the query.` };
}

const TENANT_TONE: Record<string, string> = { acme: 'text-accent', globex: 'text-violet', initech: 'text-info' };

export function RlsDemo({ onChange }: { onChange: (c: Change) => void }) {
  const [rls, setRls] = useState<Rls>('forced');
  const [role, setRole] = useState<Role>('app_user');
  const [tenant, setTenant] = useState<Tenant>('acme');
  const res = rlsResult(rls, role, tenant);

  const set = (n: { rls?: Rls; role?: Role; tenant?: Tenant }) => {
    const nr = n.rls ?? rls;
    const no = n.role ?? role;
    const nt = n.tenant ?? tenant;
    const r = rlsResult(nr, no, nt);
    const leaked = nt === 'unset' ? r.visible.length : ROWS.filter((x) => r.visible.includes(x.id) && x.tenant !== nt).length;
    const lines: ChangeLine[] = [
      r.error
        ? { tone: 'ok', text: `\`${r.error.replace('ERROR:  ', '')}\`: the request fails instead of leaking.` }
        : leaked
          ? { tone: 'bad', text: `**${leaked} rows from other tenants** visible to ${nt === 'unset' ? 'a request with no tenant' : nt}.` }
          : { tone: 'ok', text: `${r.visible.length} rows visible, all ${nt}’s.` },
      { tone: 'info', text: r.why },
    ];
    onChange({ key: `rls-${Date.now()}`, title: `RLS ${nr} · role ${no} · app.tenant_id = ${nt}`, lines });
    setRls(nr);
    setRole(no);
    setTenant(nt);
  };

  const seg = <T extends string>(label: string, v: T, opts: T[], pick: (x: T) => void) => (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button
            key={o}
            onClick={() => o !== v && pick(o)}
            className={cn('rounded-md border px-2 py-1 font-mono text-[11px]', v === o ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:border-accent/50')}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="eyebrow mb-2 flex items-center gap-1">
        <ShieldCheck size={12} /> Row-level security · <code className="normal-case">SELECT * FROM projects;</code> (no WHERE)
      </div>
      <div className="flex flex-wrap gap-4">
        {seg<Rls>('RLS', rls, ['off', 'on', 'forced'], (x) => set({ rls: x }))}
        {seg<Role>('connected as', role, ['app_user', 'owner'], (x) => set({ role: x }))}
        {seg<Tenant>('app.tenant_id', tenant, ['acme', 'globex', 'initech', 'unset'], (x) => set({ tenant: x }))}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <CodeBlock language="sql" code={RLS_SQL} highlightLines={rls === 'off' ? [] : rls === 'on' ? [1, 4, 5, 6] : [1, 2, 4, 5, 6]} />
        <div>
          <table className="w-full font-mono text-[11.5px]">
            <thead className="text-faint">
              <tr>
                <th className="py-1 text-left font-normal">id</th>
                <th className="py-1 text-left font-normal">tenant_id</th>
                <th className="py-1 text-left font-normal">name</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const vis = res.visible.includes(r.id);
                const leak = vis && tenant !== 'unset' && r.tenant !== tenant;
                return (
                  <motion.tr
                    key={r.id}
                    layout
                    animate={{ opacity: vis ? 1 : 0.22 }}
                    transition={{ duration: 0.35 }}
                    className={cn('border-t border-line', leak && 'bg-bad/10', vis && !leak && 'bg-ok/[0.06]', !vis && 'line-through')}
                  >
                    <td className="py-1 text-muted">{r.id}</td>
                    <td className={cn('py-1', TENANT_TONE[r.tenant])}>{r.tenant}</td>
                    <td className="py-1 text-ink">{r.name}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          <AnimatePresence mode="wait">
            <motion.div key={`${rls}${role}${tenant}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 font-mono text-[11px]">
              {res.error ? <span className="text-ok">{res.error}</span> : <span className={res.visible.some((id) => ROWS.find((x) => x.id === id)!.tenant !== tenant) ? 'text-bad' : 'text-ok'}>({res.visible.length} rows)</span>}
            </motion.div>
          </AnimatePresence>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            <Rich text={res.why} />
          </p>
        </div>
      </div>
      {(rls === 'off' || (rls === 'on' && role === 'owner')) && (
        <Callout tone="bad" title={rls === 'off' ? 'Red flag: tenant isolation depends on every WHERE clause' : 'Red flag: RLS enabled but not forced'}>
          <span className="text-[12px]">
            {rls === 'off'
              ? 'One forgotten predicate leaks every tenant. Fix: ENABLE + FORCE RLS on every tenant table and connect as a non-owner role without BYPASSRLS.'
              : 'The owner role bypasses the policy. Fix: `ALTER TABLE … FORCE ROW LEVEL SECURITY`, and run the app as a separate non-owner role.'}
          </span>
        </Callout>
      )}
    </div>
  );
}

/* ───────────────────────── scoped keys exercise ───────────────────────── */

type Picks = Partial<Record<KeyQuestion['id'], number>>;

interface Test {
  sql: string;
  out: string;
  tone: 'ok' | 'bad' | 'warn';
  note: string;
}

function opt(q: KeyQuestion['id'], picks: Picks) {
  const i = picks[q];
  return i === undefined ? undefined : KEY_QUESTIONS.find((x) => x.id === q)!.options[i];
}

function runTests(p: Picks): Test[] {
  const pk = p.pk;
  const fkComposite = p.fk === 1;
  const pkOk = pk === 1;
  const tests: Test[] = [];
  tests.push(
    pk === 2
      ? { sql: "INSERT INTO projects (tenant_id, name) VALUES ('acme', 'Second project');", out: 'ERROR:  duplicate key value violates unique constraint "projects_pkey"', tone: 'bad', note: 'acme can only ever have one project.' }
      : { sql: "INSERT INTO projects (tenant_id, name) VALUES ('acme', 'Second project');", out: 'INSERT 0 1', tone: 'ok', note: pkOk ? 'PK (tenant_id, id): acme’s projects are one contiguous index range.' : 'Works, but the PK index is useless for tenant-scoped scans.' },
  );
  tests.push(
    fkComposite && !pkOk
      ? { sql: 'CREATE TABLE tasks (… FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id));', out: 'ERROR:  there is no unique constraint matching given keys for referenced table "projects"', tone: 'bad', note: 'A composite FK needs a PK or UNIQUE on (tenant_id, id) to point at.' }
      : fkComposite
        ? { sql: "INSERT INTO tasks (tenant_id, project_id, title) VALUES ('acme', 7, 'x');  -- 7 is globex's", out: 'ERROR:  insert or update on table "tasks" violates foreign key constraint "tasks_tenant_id_project_id_fkey"\nDETAIL:  Key (tenant_id, project_id)=(acme, 7) is not present in table "projects".', tone: 'ok', note: 'Cross-tenant reference rejected by the database itself.' }
        : { sql: "INSERT INTO tasks (tenant_id, project_id, title) VALUES ('acme', 7, 'x');  -- 7 is globex's", out: 'INSERT 0 1', tone: 'bad', note: p.fk === 2 ? 'FK checks ignore RLS: acme’s task now points at globex’s project; joins leak its name.' : 'Any project id satisfies the FK: acme’s task now points at globex’s project.' },
  );
  tests.push(
    p.unique === 0
      ? { sql: "INSERT INTO users (tenant_id, email) VALUES ('globex', 'bob@example.com');  -- bob is in acme", out: 'ERROR:  duplicate key value violates unique constraint "users_email_key"\nDETAIL:  Key (email)=(bob@example.com) already exists.', tone: 'bad', note: 'Bob can’t join globex, and globex’s admin just learned bob uses acme.' }
      : p.unique === 2
        ? { sql: "-- two concurrent sign-ups in acme for bob@example.com", out: 'INSERT 0 1\nINSERT 0 1', tone: 'bad', note: 'Both requests passed the app’s SELECT check before either inserted: duplicate users.' }
        : { sql: "INSERT INTO users (tenant_id, email) VALUES ('globex', 'bob@example.com');  -- bob is in acme", out: 'INSERT 0 1', tone: 'ok', note: 'Unique per tenant: bob can belong to both, duplicates within a tenant are still rejected.' },
  );
  tests.push(
    p.index === 2
      ? { sql: "EXPLAIN ANALYZE SELECT * FROM tasks WHERE tenant_id = 'acme' ORDER BY created_at DESC LIMIT 20;", out: 'Index Scan using tasks_tenant_id_created_at_idx  (rows=20)\n  Index Cond: (tenant_id = \'acme\')', tone: 'ok', note: 'Reads exactly 20 index entries.' }
      : { sql: "EXPLAIN ANALYZE SELECT * FROM tasks WHERE tenant_id = 'acme' ORDER BY created_at DESC LIMIT 20;", out: `Index Scan Backward using tasks_created_at${p.index === 1 ? '_tenant_id' : ''}_idx  (rows=20)\n  Filter: (tenant_id = 'acme')\n  Rows Removed by Filter: 199980`, tone: 'bad', note: 'Walks everyone’s recent tasks to find acme’s 20: cost grows with the whole table, and a quiet tenant scans much further.' },
  );
  return tests;
}

export function ScopedKeys({ onChange, onSolved, solved }: { onChange: (c: Change) => void; onSolved: () => void; solved: boolean }) {
  const [picks, setPicks] = useState<Picks>({});
  const [ran, setRan] = useState(0);
  const complete = KEY_QUESTIONS.every((q) => picks[q.id] !== undefined);
  const right = KEY_QUESTIONS.filter((q) => opt(q.id, picks)?.ok).length;

  const pick = (q: KeyQuestion, i: number) => {
    setPicks((p) => ({ ...p, [q.id]: i }));
    setRan(0);
    onChange({ key: `key-${q.id}-${i}-${Date.now()}`, title: `${q.label}: \`${q.options[i].sql.split('\n')[0]}\``, lines: [{ tone: 'info', text: 'Run the tests to see what the database allows.' }] });
  };

  const run = () => {
    const tests = runTests(picks);
    setRan((r) => r + 1);
    const ok = right === KEY_QUESTIONS.length;
    onChange({
      key: `keys-run-${Date.now()}`,
      title: `Ran 4 tests against your DDL: ${tests.filter((t) => t.tone === 'ok').length}/4 behave correctly`,
      lines: [...tests.map((t) => ({ tone: t.tone, text: t.note })), ...(ok ? [{ tone: 'ok' as const, text: '**Exercise solved:** every key is tenant-scoped.' }] : [])],
    });
    if (ok && !solved) onSolved();
  };

  const tests = ran ? runTests(picks) : [];
  const ddl = `CREATE TABLE projects (
  tenant_id uuid NOT NULL, id bigint GENERATED ALWAYS AS IDENTITY, name text,
  ${opt('pk', picks)?.sql ?? '-- primary key ?'}
);
CREATE TABLE users (
  tenant_id uuid NOT NULL, id bigint, email text,
  ${opt('unique', picks)?.sql ?? '-- uniqueness ?'}
);
CREATE TABLE tasks (
  tenant_id uuid NOT NULL, id bigint, project_id bigint, created_at timestamptz,
  ${(opt('fk', picks)?.sql ?? '-- reference ?').replace(/\n/g, '\n  ')}
);
${opt('index', picks)?.sql ?? '-- index ?'};`;

  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">Exercise · tenant-scoped keys</div>
          <p className="text-[12.5px] text-muted">Pick the definitions for a pooled schema, then run the attacks against it.</p>
        </div>
        {solved && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-ok">
            <CheckCircle2 size={13} /> solved
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="space-y-2">
          {KEY_QUESTIONS.map((q) => (
            <div key={q.id}>
              <div className="mb-0.5 font-mono text-[11px] font-semibold text-ink">{q.label}</div>
              <div className="space-y-1">
                {q.options.map((o, i) => {
                  const sel = picks[q.id] === i;
                  const shown = ran > 0 && sel;
                  return (
                    <button
                      key={i}
                      onClick={() => pick(q, i)}
                      className={cn(
                        'flex w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left font-mono text-[11px] transition-colors',
                        shown ? (o.ok ? 'border-ok/60 bg-ok/10' : 'border-bad/60 bg-bad/10') : sel ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50',
                      )}
                    >
                      {shown ? o.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={12} className="mt-0.5 shrink-0 text-bad" /> : <Circle size={12} className={cn('mt-0.5 shrink-0', sel ? 'text-accent' : 'text-faint')} />}
                      <span className="whitespace-pre-wrap text-ink">{o.sql}</span>
                    </button>
                  );
                })}
              </div>
              {ran > 0 && opt(q.id, picks) && <p className={cn('mt-0.5 text-[11.5px]', opt(q.id, picks)!.ok ? 'text-muted' : 'text-bad')}>{opt(q.id, picks)!.why}</p>}
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <CodeBlock language="sql" code={ddl} />
          <Button size="sm" variant="primary" icon={<Play size={13} />} disabled={!complete} onClick={run}>
            Run attacks & check ({Object.keys(picks).length}/4)
          </Button>
          <AnimatePresence>
            {tests.map((t, i) => (
              <motion.div
                key={`${ran}-${i}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.25 }}
                className={cn('rounded-lg border p-2', t.tone === 'ok' ? 'border-ok/50 bg-ok/[0.05]' : 'border-bad/50 bg-bad/[0.05]')}
              >
                <div className="whitespace-pre-wrap font-mono text-[10.5px] text-muted">{t.sql}</div>
                <div className={cn('mt-1 whitespace-pre-wrap font-mono text-[10.5px]', t.tone === 'ok' ? 'text-ok' : 'text-bad')}>{t.out}</div>
                <div className="mt-1 flex items-start gap-1 text-[11.5px] text-ink">
                  {t.tone === 'ok' ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-ok" /> : <XCircle size={12} className="mt-0.5 shrink-0 text-bad" />}
                  {t.note}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
