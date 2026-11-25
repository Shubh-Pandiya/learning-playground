/**
 * A small MVCC + row-lock simulator, modelled on Postgres:
 *   - every UPDATE writes a new tuple version (xmin = writer) and stamps the old one's xmax
 *   - a snapshot decides which versions a statement can see
 *   - writers take row locks; a second writer waits, then re-checks (READ COMMITTED)
 *     or fails with 40001 (REPEATABLE READ / SERIALIZABLE)
 *   - SERIALIZABLE adds SSI: a read→write dependency cycle aborts the later committer
 *   - a wait-for cycle triggers the deadlock detector
 * READ UNCOMMITTED is simulated as a lock-free reader that sees the newest version
 * (Postgres silently upgrades it to READ COMMITTED; SQL Server NOLOCK / MySQL RU behave like this).
 */
import type { IsolationScenarioId } from '../types';

export type Level = 'RU' | 'RC' | 'RR' | 'SER';
export const LEVELS: { id: Level; label: string; short: string }[] = [
  { id: 'RU', label: 'READ UNCOMMITTED', short: 'RU' },
  { id: 'RC', label: 'READ COMMITTED', short: 'RC' },
  { id: 'RR', label: 'REPEATABLE READ', short: 'RR' },
  { id: 'SER', label: 'SERIALIZABLE', short: 'SER' },
];

export type TxName = 'T1' | 'T2';
type Data = Record<string, string | number | boolean>;
export interface Version {
  xmin: number;
  xmax?: number;
  data: Data;
}
export interface Row {
  id: string;
  versions: Version[];
}
type Vars = Record<string, number>;

export type Op =
  | { k: 'begin' }
  | { k: 'select'; sql: string; where: (d: Data) => boolean; show: (rows: Data[]) => string; save?: (rows: Data[], v: Vars) => void; name?: string; forUpdate?: boolean }
  | { k: 'update'; sql: string; where: (d: Data) => boolean; set: (d: Data, v: Vars) => Data }
  | { k: 'insert'; sql: string; row: { id: string; data: Data } }
  | { k: 'commit' }
  | { k: 'rollback' };

export interface Step {
  tx: TxName;
  op: Op;
  /** Teaching note shown with this step (level-independent context). */
  note?: string;
}

export interface Scenario {
  id: IsolationScenarioId;
  title: string;
  table: string;
  columns: string[];
  rows: Row[];
  steps: Step[];
  defaultLevel: Level;
  story: string;
  /** Verdict at the end for a level. */
  verdict: (level: Level, out: Record<string, string>, final: Data[]) => { anomaly: boolean; text: string };
  fix: string;
}

export type TxStatus = 'idle' | 'active' | 'waiting' | 'committed' | 'aborted';
export interface TxView {
  name: TxName;
  xid: number;
  status: TxStatus;
  waitingFor?: TxName;
  snapshot?: number[];
}

export interface Frame {
  rows: Row[];
  tx: Record<TxName, TxView>;
  xidStatus: Record<number, 'active' | 'committed' | 'aborted'>;
  locks: Record<string, TxName>;
  /** per executed step index → what that tx saw/got */
  outputs: Record<number, { text: string; kind: 'ok' | 'blocked' | 'error' | 'info' }>;
  events: string[];
  impact: string;
  tone: 'info' | 'ok' | 'warn' | 'bad';
  named: Record<string, string>;
}

const XID: Record<TxName, number> = { T1: 101, T2: 102 };
const other = (t: TxName): TxName => (t === 'T1' ? 'T2' : 'T1');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface Tx {
  name: TxName;
  xid: number;
  status: TxStatus;
  snap?: Set<number>;
  vars: Vars;
  reads: Set<string>;
  writes: Set<string>;
  pending?: { op: Op; stepIdx: number };
  waitingFor?: TxName;
  commitSeq?: number;
  beganSeq: number;
}

export function simulate(sc: Scenario, level: Level): Frame[] {
  const rows: Row[] = clone(sc.rows);
  const status: Record<number, 'active' | 'committed' | 'aborted'> = { 1: 'committed' };
  const locks: Record<string, TxName> = {};
  const txs: Record<TxName, Tx> = {
    T1: { name: 'T1', xid: XID.T1, status: 'idle', vars: {}, reads: new Set(), writes: new Set(), beganSeq: 0 },
    T2: { name: 'T2', xid: XID.T2, status: 'idle', vars: {}, reads: new Set(), writes: new Set(), beganSeq: 0 },
  };
  const outputs: Frame['outputs'] = {};
  const named: Record<string, string> = {};
  let seq = 0;
  const frames: Frame[] = [];

  const committedNow = () => new Set(Object.entries(status).filter(([, s]) => s === 'committed').map(([x]) => Number(x)));
  const takeSnap = (t: Tx, ev: string[]) => {
    if (level === 'RU') return;
    if (level === 'RC' || !t.snap) {
      t.snap = committedNow();
      if (level !== 'RC') ev.push(`${t.name} takes its snapshot now (first statement) and keeps it for the whole transaction.`);
    }
  };
  const visible = (t: Tx, r: Row): Version | undefined => {
    if (level === 'RU') {
      for (let i = r.versions.length - 1; i >= 0; i--) if (status[r.versions[i].xmin] !== 'aborted') return r.versions[i];
      return undefined;
    }
    const snap = t.snap ?? committedNow();
    const sees = (x?: number) => x !== undefined && (x === t.xid || snap.has(x));
    return r.versions.find((v) => sees(v.xmin) && !sees(v.xmax));
  };
  const latest = (r: Row) => {
    for (let i = r.versions.length - 1; i >= 0; i--) if (status[r.versions[i].xmin] !== 'aborted') return r.versions[i];
    return r.versions[0];
  };
  const fmtData = (d: Data) =>
    Object.entries(d)
      .filter(([k]) => k !== 'id')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

  type Res = { text: string; kind: 'ok' | 'blocked' | 'error' | 'info'; impact?: string; tone?: Frame['tone'] };

  const abort = (t: Tx, ev: string[]) => {
    t.status = 'aborted';
    status[t.xid] = 'aborted';
    t.pending = undefined;
    t.waitingFor = undefined;
    for (const [rid, h] of Object.entries(locks)) if (h === t.name) delete locks[rid];
    const n = rows.reduce((a, r) => a + r.versions.filter((v) => v.xmin === t.xid).length, 0);
    if (n) ev.push(`${t.name}'s ${n} new tuple version${n > 1 ? 's are' : ' is'} now dead (xmin ${t.xid} aborted) — invisible to everyone, VACUUM will reclaim ${n > 1 ? 'them' : 'it'}.`);
  };

  const exec = (t: Tx, op: Op, stepIdx: number, ev: string[], resumed = false): Res => {
    if (t.status === 'aborted') {
      if (op.k === 'commit' || op.k === 'rollback') return { text: 'ROLLBACK (transaction was already aborted)', kind: 'error' };
      return { text: 'ERROR: current transaction is aborted, commands ignored until end of transaction block', kind: 'error' };
    }
    if (t.status === 'waiting' && !resumed) return { text: '…still blocked; this statement queues in the session', kind: 'blocked' };
    switch (op.k) {
      case 'begin':
        t.status = 'active';
        t.beganSeq = ++seq;
        status[t.xid] = 'active';
        ev.push(`${t.name} starts (xid ${t.xid}).`);
        return { text: 'BEGIN', kind: 'info' };
      case 'select': {
        takeSnap(t, ev);
        if (op.forUpdate) {
          const target = rows.filter((r) => {
            const v = visible(t, r);
            return v && op.where(v.data);
          });
          for (const r of target) {
            const h = locks[r.id];
            if (h && h !== t.name) return block(t, op, stepIdx, h, r.id, ev);
          }
          for (const r of target) {
            const lv = latest(r);
            const vv = visible(t, r)!;
            if (lv !== vv) {
              if (level === 'RR' || level === 'SER') return serFail(t, r.id, ev);
              ev.push(`READ COMMITTED re-reads the newest committed version of ${r.id} after the wait (${fmtData(lv.data)}).`);
            }
            locks[r.id] = t.name;
            t.reads.add(r.id);
          }
          const data = target.map((r) => latest(r).data);
          op.save?.(data, t.vars);
          const txt = op.show(data);
          if (op.name) named[op.name] = txt;
          ev.push(`${t.name} reads and row-locks ${target.map((r) => r.id).join(', ')} (FOR UPDATE) → ${txt}. Any other writer or FOR UPDATE on ${target.length > 1 ? 'these rows' : 'this row'} must now wait.`);
          return { text: txt, kind: 'ok' };
        }
        const seen: Data[] = [];
        for (const r of rows) {
          const v = visible(t, r);
          if (v && op.where(v.data)) {
            seen.push(v.data);
            t.reads.add(r.id);
            if (level === 'RU' && status[v.xmin] === 'active' && v.xmin !== t.xid) ev.push(`⚠ ${t.name} read ${r.id} from xid ${v.xmin}, which has NOT committed — a dirty read.`);
          }
        }
        if (level === 'SER') t.reads.add('*pred');
        op.save?.(seen, t.vars);
        const txt = op.show(seen);
        if (op.name) named[op.name] = txt;
        ev.push(`${t.name} reads → ${txt}${level === 'RC' ? ' (fresh snapshot for this statement)' : level === 'RU' ? ' (no snapshot: newest version, committed or not)' : ' (from its transaction snapshot)'}.`);
        return { text: txt, kind: 'ok' };
      }
      case 'update': {
        takeSnap(t, ev);
        const target = rows.filter((r) => {
          const v = visible(t, r);
          return v && op.where(v.data);
        });
        for (const r of target) {
          const h = locks[r.id];
          if (h && h !== t.name) return block(t, op, stepIdx, h, r.id, ev);
        }
        const changed: string[] = [];
        for (const r of target) {
          const lv = latest(r);
          const vv = visible(t, r)!;
          let base = vv;
          if (lv !== vv && lv.xmin !== t.xid) {
            if (level === 'RR' || level === 'SER') return serFail(t, r.id, ev);
            if (!op.where(lv.data)) {
              ev.push(`Row ${r.id} no longer matches the WHERE after re-check → skipped.`);
              continue;
            }
            ev.push(`READ COMMITTED: the row changed while ${t.name} waited, so Postgres re-evaluates the UPDATE against the newest committed version (${fmtData(lv.data)}).`);
            base = lv;
          }
          base = lv.xmin === t.xid ? lv : base;
          const nd = op.set({ ...base.data }, t.vars);
          base.xmax = t.xid;
          r.versions.push({ xmin: t.xid, data: nd });
          locks[r.id] = t.name;
          t.writes.add(r.id);
          changed.push(`${r.id}: ${fmtData(base.data)} → ${fmtData(nd)}`);
        }
        ev.push(changed.length ? `${t.name} writes new version${changed.length > 1 ? 's' : ''} (xmin ${t.xid}) and stamps xmax ${t.xid} on the old one: ${changed.join('; ')}. It holds the row lock until COMMIT/ROLLBACK.` : `${t.name}'s UPDATE matched no rows.`);
        return { text: `UPDATE ${changed.length}`, kind: 'ok' };
      }
      case 'insert': {
        takeSnap(t, ev);
        rows.push({ id: op.row.id, versions: [{ xmin: t.xid, data: op.row.data }] });
        t.writes.add(op.row.id);
        t.writes.add('*pred');
        ev.push(`${t.name} inserts ${op.row.id} (${fmtData(op.row.data)}) with xmin ${t.xid} — invisible to others until ${t.name} commits.`);
        return { text: 'INSERT 0 1', kind: 'ok' };
      }
      case 'commit': {
        if (level === 'SER') {
          const o = txs[other(t.name)];
          const concurrent = o.status === 'committed' && (o.commitSeq ?? 0) > t.beganSeq;
          const inter = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));
          if (concurrent && inter(t.reads, o.writes) && inter(o.reads, t.writes)) {
            ev.push(`SSI found a dangerous structure: ${t.name} read rows ${o.name} wrote, and ${o.name} read rows ${t.name} wrote, concurrently. No serial order explains both → ${t.name} is aborted.`);
            abort(t, ev);
            return { text: 'ERROR 40001: could not serialize access due to read/write dependencies among transactions', kind: 'error', impact: 'The app must catch SQLSTATE 40001 and retry the whole transaction. Retrying re-reads the new state and makes the correct decision.', tone: 'ok' };
          }
        }
        t.status = 'committed';
        status[t.xid] = 'committed';
        t.commitSeq = ++seq;
        const released = Object.entries(locks)
          .filter(([, h]) => h === t.name)
          .map(([r]) => r);
        released.forEach((r) => delete locks[r]);
        ev.push(`${t.name} commits: xid ${t.xid} is marked committed in the commit log (pg_xact) — its versions become visible to snapshots taken from now on${released.length ? `; row locks on ${released.join(', ')} released` : ''}.`);
        return { text: 'COMMIT', kind: 'ok' };
      }
      case 'rollback':
        abort(t, ev);
        ev.unshift(`${t.name} rolls back.`);
        return { text: 'ROLLBACK', kind: 'info' };
    }
  };

  const serFail = (t: Tx, rid: string, ev: string[]): Res => {
    ev.push(`${t.name} (${level === 'RR' ? 'REPEATABLE READ' : 'SERIALIZABLE'}) tried to modify ${rid}, but a concurrent transaction already committed a newer version that ${t.name}'s snapshot can’t see. Overwriting it would lose that update → error.`);
    abort(t, ev);
    return { text: 'ERROR 40001: could not serialize access due to concurrent update', kind: 'error', impact: 'No update is lost: the app catches 40001 and retries the transaction, which then sees the new value.', tone: 'ok' };
  };

  const block = (t: Tx, op: Op, stepIdx: number, holder: TxName, rid: string, ev: string[]): Res => {
    const h = txs[holder];
    if (h.status === 'waiting' && h.waitingFor === t.name) {
      ev.push(`${t.name} needs ${rid}, held by ${holder}; ${holder} is waiting for a row ${t.name} holds. Wait-for cycle T1 → T2 → T1.`);
      ev.push(`After deadlock_timeout (1s) the deadlock detector aborts ${t.name} to break the cycle.`);
      abort(t, ev);
      const res = resume(h, ev);
      return { text: 'ERROR 40P01: deadlock detected', kind: 'error', impact: `${holder} continues${res ? '' : ''}; ${t.name}'s work is rolled back and must be retried. Fix: lock rows in a consistent order (e.g. ORDER BY id … FOR UPDATE) so no cycle can form.`, tone: 'bad' };
    }
    t.status = 'waiting';
    t.waitingFor = holder;
    t.pending = { op, stepIdx };
    ev.push(`${t.name} needs a row lock on ${rid}, but ${holder} holds it (uncommitted write). ${t.name} blocks until ${holder} commits or rolls back.`);
    return { text: `⏳ waiting for ${holder} (lock on ${rid})`, kind: 'blocked', impact: 'Blocked connections hold a pool slot and add latency; long transactions make every writer to the same row queue up.', tone: 'warn' };
  };

  const resume = (w: Tx, ev: string[]) => {
    if (w.status !== 'waiting' || !w.pending) return undefined;
    const p = w.pending;
    w.status = 'active';
    w.waitingFor = undefined;
    w.pending = undefined;
    ev.push(`${w.name} wakes up and retries its blocked statement.`);
    const r = exec(w, p.op, p.stepIdx, ev, true);
    outputs[p.stepIdx] = { text: r.text, kind: r.kind };
    return r;
  };

  frames.push({ rows: clone(rows), tx: view(), xidStatus: { ...status }, locks: { ...locks }, outputs: {}, events: ['Both sessions are connected. Nothing has run yet.'], impact: sc.story, tone: 'info', named: {} });

  sc.steps.forEach((s, i) => {
    const ev: string[] = [];
    if (s.note) ev.push(s.note);
    const t = txs[s.tx];
    const r = exec(t, s.op, i, ev);
    outputs[i] = { text: r.text, kind: r.kind };
    let impact = r.impact ?? '';
    let tone: Frame['tone'] = r.tone ?? 'info';
    if ((s.op.k === 'commit' || s.op.k === 'rollback') && r.kind !== 'error') {
      const w = txs[other(s.tx)];
      if (w.waitingFor === s.tx) {
        const rr = resume(w, ev);
        if (rr?.impact) {
          impact = rr.impact;
          tone = rr.tone ?? tone;
        }
      }
    }
    frames.push({ rows: clone(rows), tx: view(), xidStatus: { ...status }, locks: { ...locks }, outputs: clone(outputs), events: ev, impact, tone, named: { ...named } });
  });

  function view(): Record<TxName, TxView> {
    const v = (t: Tx): TxView => ({ name: t.name, xid: t.xid, status: t.status, waitingFor: t.waitingFor, snapshot: t.snap ? [...t.snap].filter((x) => x !== 1) : undefined });
    return { T1: v(txs.T1), T2: v(txs.T2) };
  }
  return frames;
}

/** What each transaction would see right now (for the "T1 sees / T2 sees" columns). */
export function seenBy(frame: Frame, tx: TxName, row: Row, level: Level): Version | undefined {
  const t = frame.tx[tx];
  const st = frame.xidStatus;
  if (level === 'RU') {
    for (let i = row.versions.length - 1; i >= 0; i--) if (st[row.versions[i].xmin] !== 'aborted') return row.versions[i];
    return undefined;
  }
  const snap = level === 'RC' || !t.snapshot ? new Set(Object.entries(st).filter(([, s]) => s === 'committed').map(([x]) => Number(x))) : new Set([1, ...t.snapshot]);
  const sees = (x?: number) => x !== undefined && (x === t.xid || snap.has(x));
  return row.versions.find((v) => sees(v.xmin) && !sees(v.xmax));
}

export function finalCommitted(frame: Frame): Data[] {
  return frame.rows
    .map((r) => [...r.versions].reverse().find((v) => frame.xidStatus[v.xmin] === 'committed'))
    .filter((v): v is Version => !!v)
    .map((v) => v.data);
}

/* ------------------------------------------------------------------ scenarios */

const acct = (id: string, balance: number): Row => ({ id, versions: [{ xmin: 1, data: { id, balance } }] });
const sum = (rs: Data[], c: string) => rs.reduce((a, r) => a + Number(r[c]), 0);

export const SCENARIOS: Record<IsolationScenarioId, Scenario> = {
  'dirty-read': {
    id: 'dirty-read',
    title: 'Dirty read',
    table: 'accounts',
    columns: ['balance'],
    rows: [acct('alice', 200)],
    defaultLevel: 'RU',
    story: 'A transfer debits Alice, then fails and rolls back. Meanwhile a fraud-check job reads her balance.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'update', sql: "UPDATE accounts SET balance = balance - 150 WHERE id = 'alice';", where: (d) => d.id === 'alice', set: (d) => ({ ...d, balance: Number(d.balance) - 150 }) } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'select', sql: "SELECT balance FROM accounts WHERE id = 'alice';", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, name: 'read' } },
      { tx: 'T1', op: { k: 'rollback' }, note: 'The transfer fails (e.g. the credit side violates a constraint).' },
      { tx: 'T2', op: { k: 'commit' } },
    ],
    verdict: (_l, out) =>
      out.read === 'balance = 50'
        ? { anomaly: true, text: 'T2 acted on balance = 50, a value that **never existed** in any committed state (T1 rolled back). A fraud job could have frozen a healthy account.' }
        : { anomaly: false, text: 'T2 saw 200 — only committed data. MVCC readers read the old version instead of waiting; readers never block writers and writers never block readers.' },
    fix: 'Any level ≥ READ COMMITTED prevents dirty reads (Postgres never allows them; `READ UNCOMMITTED` behaves as READ COMMITTED).',
  },
  'non-repeatable-read': {
    id: 'non-repeatable-read',
    title: 'Non-repeatable read',
    table: 'accounts',
    columns: ['balance'],
    rows: [acct('alice', 200)],
    defaultLevel: 'RC',
    story: 'A report reads Alice’s balance twice in one transaction (header and detail section) while a payment commits in between.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'select', sql: "SELECT balance FROM accounts WHERE id = 'alice';", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, name: 'first' } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'update', sql: "UPDATE accounts SET balance = 120 WHERE id = 'alice';", where: (d) => d.id === 'alice', set: (d) => ({ ...d, balance: 120 }) } },
      { tx: 'T2', op: { k: 'commit' } },
      { tx: 'T1', op: { k: 'select', sql: "SELECT balance FROM accounts WHERE id = 'alice';", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, name: 'second' } },
      { tx: 'T1', op: { k: 'commit' } },
    ],
    verdict: (_l, out) =>
      out.first !== out.second
        ? { anomaly: true, text: `Same query, same transaction, different answers (${out.first} then ${out.second}). The report’s header and detail disagree.` }
        : { anomaly: false, text: `Both reads returned ${out.first}: the transaction reads from one snapshot taken at its first statement.` },
    fix: 'Use REPEATABLE READ for multi-statement reports (one snapshot for the whole transaction), or compute everything in a single statement.',
  },
  phantom: {
    id: 'phantom',
    title: 'Phantom read',
    table: 'orders',
    columns: ['status', 'amount'],
    rows: [
      { id: 'o1', versions: [{ xmin: 1, data: { id: 'o1', status: 'pending', amount: 40 } }] },
      { id: 'o2', versions: [{ xmin: 1, data: { id: 'o2', status: 'pending', amount: 25 } }] },
      { id: 'o3', versions: [{ xmin: 1, data: { id: 'o3', status: 'shipped', amount: 90 } }] },
    ],
    defaultLevel: 'RC',
    story: 'A batch job counts pending orders, then sums them to build a payout file. A checkout inserts a new pending order in between.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'select', sql: "SELECT count(*) FROM orders WHERE status = 'pending';", where: (d) => d.status === 'pending', show: (r) => `count = ${r.length}`, name: 'count1' } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'insert', sql: "INSERT INTO orders VALUES ('o4', 'pending', 60);", row: { id: 'o4', data: { id: 'o4', status: 'pending', amount: 60 } } } },
      { tx: 'T2', op: { k: 'commit' } },
      { tx: 'T1', op: { k: 'select', sql: "SELECT count(*), sum(amount) FROM orders WHERE status = 'pending';", where: (d) => d.status === 'pending', show: (r) => `count = ${r.length}, sum = ${sum(r, 'amount')}`, name: 'count2' } },
      { tx: 'T1', op: { k: 'commit' } },
    ],
    verdict: (_l, out) =>
      out.count1 !== out.count2.split(',')[0]
        ? { anomaly: true, text: `A row that matches the predicate appeared mid-transaction (${out.count1} → ${out.count2}). The file header says ${out.count1.split('= ')[1]} orders but the body pays out a different set.` }
        : { anomaly: false, text: `Still ${out.count1}: the new row’s xmin (102) isn’t in T1’s snapshot. Postgres’s REPEATABLE READ is snapshot isolation, so it prevents phantoms even though the SQL standard allows them at RR (MySQL InnoDB RR uses next-key locks instead).` },
    fix: 'REPEATABLE READ (snapshot) for consistent multi-statement reads; SERIALIZABLE if the transaction also writes based on what it counted.',
  },
  'lost-update': {
    id: 'lost-update',
    title: 'Lost update (read-modify-write)',
    table: 'accounts',
    columns: ['balance'],
    rows: [acct('alice', 200)],
    defaultLevel: 'RC',
    story: 'Two API requests withdraw from the same wallet. Each reads the balance into the app, subtracts, and writes the number back.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'select', sql: "SELECT balance FROM accounts WHERE id = 'alice';  -- app: b = 200", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, save: (r, v) => (v.b = Number(r[0]?.balance)) } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'select', sql: "SELECT balance FROM accounts WHERE id = 'alice';  -- app: b = 200", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, save: (r, v) => (v.b = Number(r[0]?.balance)) } },
      { tx: 'T1', op: { k: 'update', sql: "UPDATE accounts SET balance = :b - 50 WHERE id = 'alice';  -- 150", where: (d) => d.id === 'alice', set: (d, v) => ({ ...d, balance: v.b - 50 }) } },
      { tx: 'T2', op: { k: 'update', sql: "UPDATE accounts SET balance = :b - 30 WHERE id = 'alice';  -- 170", where: (d) => d.id === 'alice', set: (d, v) => ({ ...d, balance: v.b - 30 }) } },
      { tx: 'T1', op: { k: 'commit' } },
      { tx: 'T2', op: { k: 'commit' } },
    ],
    verdict: (_l, _o, final) => {
      const b = Number(final.find((d) => d.id === 'alice')?.balance);
      return b === 170
        ? { anomaly: true, text: 'Final balance 170, but 80 was withdrawn from 200 → should be 120. T1’s −50 was **silently overwritten**: no error, no log line. Money was created.' }
        : b === 150
          ? { anomaly: false, text: 'Final balance 150: T2 failed with 40001 instead of overwriting. After a retry it would read 150 and write 120 — nothing lost.' }
          : { anomaly: false, text: `Final balance ${b}.` };
    },
    fix: 'Make the write atomic (`SET balance = balance - 30`), lock first (`SELECT … FOR UPDATE`), use optimistic locking (`WHERE version = :v`), or run at REPEATABLE READ and retry on 40001.',
  },
  'lost-update-fixed': {
    id: 'lost-update-fixed',
    title: 'Lost update, fixed with SELECT … FOR UPDATE',
    table: 'accounts',
    columns: ['balance'],
    rows: [acct('alice', 200)],
    defaultLevel: 'RC',
    story: 'The same two withdrawals, but each request locks the row before reading it.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'select', forUpdate: true, sql: "SELECT balance FROM accounts WHERE id = 'alice' FOR UPDATE;", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, save: (r, v) => (v.b = Number(r[0]?.balance)) } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'select', forUpdate: true, sql: "SELECT balance FROM accounts WHERE id = 'alice' FOR UPDATE;", where: (d) => d.id === 'alice', show: (r) => `balance = ${r[0]?.balance}`, save: (r, v) => (v.b = Number(r[0]?.balance)) } },
      { tx: 'T1', op: { k: 'update', sql: "UPDATE accounts SET balance = :b - 50 WHERE id = 'alice';", where: (d) => d.id === 'alice', set: (d, v) => ({ ...d, balance: v.b - 50 }) } },
      { tx: 'T1', op: { k: 'commit' } },
      { tx: 'T2', op: { k: 'update', sql: "UPDATE accounts SET balance = :b - 30 WHERE id = 'alice';", where: (d) => d.id === 'alice', set: (d, v) => ({ ...d, balance: v.b - 30 }) } },
      { tx: 'T2', op: { k: 'commit' } },
    ],
    verdict: (_l, _o, final) => {
      const b = Number(final.find((d) => d.id === 'alice')?.balance);
      return b === 120
        ? { anomaly: false, text: 'Final balance 120 = 200 − 50 − 30. T2’s read waited for T1’s lock, so it computed from 150, not 200. Cost: T2 was blocked for the length of T1’s transaction.' }
        : { anomaly: false, text: `Final balance ${b} (T2 failed, nothing lost). At REPEATABLE READ the locked row changed after T2’s snapshot, so T2 gets 40001 and must retry — correct but with a retry instead of a wait.` };
    },
    fix: 'Keep the locked section short (no network calls while holding the lock). For simple counters prefer a single atomic `UPDATE … SET x = x - :n WHERE x >= :n RETURNING x`.',
  },
  'write-skew': {
    id: 'write-skew',
    title: 'Write skew',
    table: 'doctors',
    columns: ['on_call'],
    rows: [
      { id: 'alice', versions: [{ xmin: 1, data: { id: 'alice', on_call: true } }] },
      { id: 'bob', versions: [{ xmin: 1, data: { id: 'bob', on_call: true } }] },
    ],
    defaultLevel: 'RR',
    story: 'Rule: at least one doctor must be on call. Alice and Bob both feel sick and press “go off call” at the same moment. Each request checks the rule first.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'select', sql: 'SELECT count(*) FROM doctors WHERE on_call;', where: (d) => d.on_call === true, show: (r) => `count = ${r.length}  → ok to leave` } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'select', sql: 'SELECT count(*) FROM doctors WHERE on_call;', where: (d) => d.on_call === true, show: (r) => `count = ${r.length}  → ok to leave` } },
      { tx: 'T1', op: { k: 'update', sql: "UPDATE doctors SET on_call = false WHERE id = 'alice';", where: (d) => d.id === 'alice', set: (d) => ({ ...d, on_call: false }) } },
      { tx: 'T2', op: { k: 'update', sql: "UPDATE doctors SET on_call = false WHERE id = 'bob';", where: (d) => d.id === 'bob', set: (d) => ({ ...d, on_call: false }) } },
      { tx: 'T1', op: { k: 'commit' } },
      { tx: 'T2', op: { k: 'commit' } },
    ],
    verdict: (_l, _o, final) => {
      const n = final.filter((d) => d.on_call === true).length;
      return n === 0
        ? { anomaly: true, text: 'Nobody is on call. Each transaction’s check was true **in its own snapshot**, and they wrote **different rows**, so no row-lock conflict and no 40001. Snapshot isolation alone can’t see this.' }
        : { anomaly: false, text: `${n} doctor still on call. SERIALIZABLE (SSI) tracked that each read what the other wrote and aborted the later committer; on retry it sees count = 1 and refuses.` };
    },
    fix: 'SERIALIZABLE + retry on 40001; or materialize the conflict (lock a shared row, e.g. `SELECT … FROM shifts WHERE id = :s FOR UPDATE`); or enforce it with a constraint/trigger.',
  },
  deadlock: {
    id: 'deadlock',
    title: 'Deadlock',
    table: 'accounts',
    columns: ['balance'],
    rows: [acct('A', 100), acct('B', 100)],
    defaultLevel: 'RC',
    story: 'Two transfers run at once: A→B and B→A. Each locks its source account first.',
    steps: [
      { tx: 'T1', op: { k: 'begin' } },
      { tx: 'T2', op: { k: 'begin' } },
      { tx: 'T1', op: { k: 'update', sql: "UPDATE accounts SET balance = balance - 10 WHERE id = 'A';", where: (d) => d.id === 'A', set: (d) => ({ ...d, balance: Number(d.balance) - 10 }) } },
      { tx: 'T2', op: { k: 'update', sql: "UPDATE accounts SET balance = balance - 20 WHERE id = 'B';", where: (d) => d.id === 'B', set: (d) => ({ ...d, balance: Number(d.balance) - 20 }) } },
      { tx: 'T1', op: { k: 'update', sql: "UPDATE accounts SET balance = balance + 10 WHERE id = 'B';", where: (d) => d.id === 'B', set: (d) => ({ ...d, balance: Number(d.balance) + 10 }) } },
      { tx: 'T2', op: { k: 'update', sql: "UPDATE accounts SET balance = balance + 20 WHERE id = 'A';", where: (d) => d.id === 'A', set: (d) => ({ ...d, balance: Number(d.balance) + 20 }) } },
      { tx: 'T1', op: { k: 'commit' } },
      { tx: 'T2', op: { k: 'commit' } },
    ],
    verdict: () => ({ anomaly: true, text: 'T1 waited for B (held by T2) while T2 waited for A (held by T1). Postgres detected the cycle and killed T2. Isolation level doesn’t matter: deadlocks come from **lock order**, not snapshots.' }),
    fix: 'Always lock rows in a deterministic order (e.g. `SELECT … WHERE id IN (:a, :b) ORDER BY id FOR UPDATE` first), keep transactions short, and retry on 40P01.',
  },
};
