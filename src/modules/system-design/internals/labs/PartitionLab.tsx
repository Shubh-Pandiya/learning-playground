import { useMemo, useState } from 'react';
import { Crown, Scissors, Server, Users } from 'lucide-react';
import { cn } from '@/shared/cn';
import { Button } from '@/shared/ui';
import { LabFrame, Seg, Slider, Stat, useTicker } from './kit';

type Reg = 'eureka' | 'consul' | 'zk';
type Scen = 'zone' | 'hb';
type Read = 'ok' | 'stale' | 'down';
type Write = 'ok' | 'down' | 'diverge';

interface Side {
  reads: Read;
  writes: Write;
  own: boolean;
  other: boolean;
  err: number;
  note: string;
}
interface Ev {
  at: number;
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'info';
}

const EUREKA_SP = 60;
const EUREKA_EVICT = 150;
const EUREKA_CLIENT = 210;
const GOSSIP = 7;
const SESSION = 10;

function errOf(scen: Scen, own: boolean, other: boolean, guard: boolean): { err: number; own: boolean; other: boolean } {
  if (!own && !other && guard) {
    own = true;
    other = true;
  }
  const view = (own ? 3 : 0) + (other ? 3 : 0);
  if (view === 0) return { err: 1, own, other };
  if (scen === 'hb') return { err: 0, own, other };
  return { err: other ? 3 / view : 0, own, other };
}

function simulate(reg: Reg, scen: Scen, t: number, o: { sp: boolean; stale: boolean; guard: boolean }): { A: Side; B: Side; events: Ev[] } {
  const ev: Ev[] = [];
  const side = (reads: Read, writes: Write, own: boolean, other: boolean, note: string): Side => {
    const r = errOf(scen, own, other, o.guard);
    const guarded = r.own !== own || r.other !== other;
    return { reads, writes, own: r.own, other: r.other, err: r.err, note: guarded ? `${note} · panic guard kept the last-known list` : note };
  };

  if (reg === 'eureka') {
    ev.push({ at: 0, text: scen === 'zone' ? 'each zone stops receiving the other zone’s renewals (50% of renewals lost)' : 'renewals stop reaching the registry (data path still fine)', tone: 'warn' });
    if (o.sp) {
      ev.push({ at: EUREKA_SP, text: 'renewals < 85% of expected → SELF-PRESERVATION: eviction disabled, registry freezes', tone: scen === 'zone' ? 'warn' : 'ok' });
      const other = true;
      const own = true;
      const note =
        scen === 'zone'
          ? 'self-preservation keeps the unreachable zone listed: half of calls go to instances you cannot reach'
          : 'registry is frozen but correct: everything is still alive, so nothing breaks';
      const s = side('ok', scen === 'zone' ? 'diverge' : 'ok', own, other, note);
      return { A: s, B: s, events: ev };
    }
    ev.push({ at: EUREKA_EVICT, text: 'leases (90s) expired + eviction tick (60s) → entries evicted', tone: scen === 'zone' ? 'ok' : 'bad' });
    ev.push({ at: EUREKA_CLIENT, text: 'server response cache + client fetch + LB cache → callers finally see it', tone: scen === 'zone' ? 'ok' : 'bad' });
    const gone = t >= EUREKA_CLIENT;
    if (scen === 'zone') {
      const s = side('ok', 'diverge', true, !gone, gone ? 'other zone evicted: only reachable instances remain' : 'other zone still listed: ~50% of calls fail until eviction reaches clients');
      return { A: s, B: s, events: ev };
    }
    const s = side('ok', 'ok', !gone, !gone, gone ? 'every healthy instance was evicted: callers have an EMPTY list' : 'leases not expired yet');
    return { A: s, B: s, events: ev };
  }

  if (reg === 'consul') {
    if (scen === 'zone') {
      ev.push({ at: 0, text: 'servers in zone B lose the Raft leader', tone: 'warn' });
      ev.push({ at: 2, text: 'zone A (majority) elects/keeps a leader; zone B has no quorum → "No cluster leader"', tone: 'bad' });
      ev.push({ at: GOSSIP, text: 'SWIM gossip in zone A marks zone-B nodes failed → serfHealth critical → removed from healthy results', tone: 'ok' });
      const A = side('ok', 'ok', true, t < GOSSIP, t < GOSSIP ? 'gossip has not declared zone B failed yet' : 'catalog committed via Raft: only reachable, healthy instances');
      const bRead: Read = t < 2 ? 'ok' : o.stale ? 'stale' : 'down';
      const B = side(
        bRead,
        t < 2 ? 'ok' : 'down',
        true,
        true,
        bRead === 'ok'
          ? 'leader timeout not reached'
          : o.stale
            ? '?stale reads answer from the frozen local copy: zone A still listed as passing'
            : 'consistent reads fail; existing clients reuse cached results, new pods cannot discover anything',
      );
      return { A, B, events: ev };
    }
    ev.push({ at: 0, text: 'agents cannot reach the servers; health checks still run locally on each agent', tone: 'warn' });
    ev.push({ at: 1, text: 'gossip probes are peer-to-peer with indirect pings: no node is declared failed', tone: 'ok' });
    ev.push({ at: 30, text: 'anti-entropy sync to servers stalls: new registrations/deregistrations are delayed', tone: 'info' });
    const s = side('ok', t < 30 ? 'ok' : 'down', true, true, 'catalog unchanged and correct; only changes are delayed');
    return { A: s, B: s, events: ev };
  }

  // ZooKeeper / etcd: ephemeral znodes / leases tied to sessions.
  if (scen === 'zone') {
    ev.push({ at: 0, text: 'zone B ensemble members lose the leader', tone: 'warn' });
    ev.push({ at: 2, text: 'zone B members stop serving (ZK) / reject linearizable reads (etcd)', tone: 'bad' });
    ev.push({ at: SESSION, text: 'zone B sessions/leases expire on the majority → ephemeral nodes deleted → watches fire in zone A', tone: 'ok' });
    const A = side('ok', 'ok', true, t < SESSION + 1, t < SESSION + 1 ? 'zone-B sessions still within timeout' : 'zone-B registrations deleted: only reachable instances');
    const B = side(t < 2 ? 'ok' : 'down', t < 2 ? 'ok' : 'down', true, true, t < 2 ? 'leader timeout not reached' : 'disconnected: client caches (e.g. Curator ServiceCache) keep the last list, which includes zone A');
    return { A, B, events: ev };
  }
  ev.push({ at: 0, text: 'clients cannot reach the ensemble: session heartbeats stop', tone: 'warn' });
  ev.push({ at: SESSION, text: 'session timeout → EVERY ephemeral registration deleted (mass deregistration)', tone: 'bad' });
  ev.push({ at: SESSION + 1, text: 'watches fire with an empty child list → callers drop all endpoints', tone: 'bad' });
  const gone = t >= SESSION + 1;
  const s = side('ok', 'ok', !gone, !gone, gone ? 'CP registry chose consistency: instances it cannot hear are dead to it' : 'within session timeout');
  return { A: s, B: s, events: ev };
}

function healNotes(reg: Reg, scen: Scen, sp: boolean): string {
  if (reg === 'eureka')
    return sp
      ? 'Peers replicate again; instances get 404 on renew and re-register. Self-preservation exits once renewals recover, but leases that really died during the partition linger until then.'
      : 'Evicted instances get 404 on their next renewal and re-register; callers see them again after ~30–90s of caches. Registries of the two zones reconcile by peer replication (last-writer-wins on dirty timestamps).';
  if (reg === 'consul')
    return scen === 'zone'
      ? 'Zone B servers rejoin as followers and catch up the Raft log; gossip clears the failed state and nodes reappear as passing within seconds. No data loss, because B never accepted writes.'
      : 'Anti-entropy pushes the delayed changes; the catalog was right all along.';
  return 'Every client whose session expired gets SESSION_EXPIRED on reconnect and must recreate its ephemeral nodes. An app that only handles Disconnected, not Expired, stays invisible forever: a classic outage. Reconnect storms can also overload the ensemble.';
}

const REGS = [
  { value: 'eureka' as const, label: 'Eureka (AP)', hint: 'peer-replicated, no consensus, self-preservation' },
  { value: 'consul' as const, label: 'Consul (CP + gossip)', hint: 'Raft catalog + SWIM membership' },
  { value: 'zk' as const, label: 'ZooKeeper / etcd (CP)', hint: 'ephemeral znodes / leases bound to sessions' },
];

export default function PartitionLab() {
  const [reg, setReg] = useState<Reg>('eureka');
  const [scen, setScen] = useState<Scen>('zone');
  const [servers, setServers] = useState<3 | 5>(3);
  const [sp, setSp] = useState(true);
  const [stale, setStale] = useState(false);
  const [guard, setGuard] = useState(false);
  const [cut, setCut] = useState(false);
  const [t, setT] = useState(0);
  const [healed, setHealed] = useState<number | null>(null);
  const [speed, setSpeed] = useState(10);

  useTicker(cut, 100, () => setT((x) => Math.min(300, x + speed * 0.1)));

  const sim = useMemo(() => simulate(reg, scen, t, { sp, stale, guard }), [reg, scen, t, sp, stale, guard]);
  const majority = Math.floor(servers / 2) + 1;
  const inA = majority;
  const inB = servers - majority;

  const reset = () => {
    setCut(false);
    setT(0);
    setHealed(null);
  };
  const change = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    reset();
  };

  const A: Side = cut ? sim.A : { reads: 'ok', writes: 'ok', own: true, other: true, err: 0, note: 'healthy: everything registered and reachable' };
  const B: Side = cut ? sim.B : A;
  const cp = reg !== 'eureka';
  const minorityDown = cut && cp && scen === 'zone' && t >= 2;

  const READ_TONE: Record<Read, string> = { ok: 'text-ok', stale: 'text-warn', down: 'text-bad' };
  const WRITE_TONE: Record<Write, string> = { ok: 'text-ok', diverge: 'text-warn', down: 'text-bad' };

  const ZoneCol = ({ id, s, n }: { id: 'A' | 'B'; s: Side; n: number }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className="font-semibold">zone {id}</span>
        <span className="text-faint">
          reads <b className={READ_TONE[s.reads]}>{s.reads}</b> · writes <b className={WRITE_TONE[s.writes]}>{s.writes}</b>
        </span>
      </div>
      <div className={cn('flex min-h-[44px] items-center gap-1.5 rounded-md border border-dashed p-1.5', id === 'B' && minorityDown ? 'border-bad/60 bg-bad/[0.06]' : 'border-line')}>
        <span className="eyebrow w-14">registry</span>
        {Array.from({ length: n }, (_, i) => {
          const leader = cp && i === 0 && (id === 'A' || !cut);
          const lost = id === 'B' && minorityDown;
          return (
            <div key={i} className={cn('flex h-8 w-8 items-center justify-center rounded-full border', lost ? 'border-bad/60 text-bad opacity-60' : 'border-info/60 bg-info/10 text-info')} title={leader ? 'Raft / ZAB leader' : lost ? 'no quorum' : reg === 'eureka' ? 'Eureka peer' : 'follower'}>
              {leader ? <Crown size={13} /> : <Server size={13} />}
            </div>
          );
        })}
        {id === 'B' && minorityDown && <span className="font-mono text-[10px] text-bad">no quorum ({n}/{servers})</span>}
        {reg === 'eureka' && cut && scen === 'zone' && <span className="font-mono text-[10px] text-warn">serving its own copy</span>}
      </div>
      {scen === 'hb' && cut && <div className="h-0 border-t-2 border-dashed border-bad" title="registry cannot hear instances" />}
      <div className="flex items-center gap-1.5 rounded-md border border-line p-1.5">
        <span className="eyebrow w-14">instances</span>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex h-8 flex-1 items-center justify-center rounded-md border border-ok/50 bg-ok/10 font-mono text-[10px]">
            {id.toLowerCase()}
            {i}
          </div>
        ))}
      </div>
      <div className="rounded-md border border-line bg-surface p-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
          <Users size={12} className="text-muted" />
          clients here see:
          <span className={cn('rounded px-1', s.own ? 'bg-ok/15 text-ok' : 'bg-ink/5 text-faint line-through')}>zone {id}</span>
          <span className={cn('rounded px-1', s.other ? (scen === 'zone' && cut ? 'bg-bad/15 text-bad' : 'bg-ok/15 text-ok') : 'bg-ink/5 text-faint line-through')}>zone {id === 'A' ? 'B' : 'A'}</span>
          <span className={cn('ml-auto font-semibold', s.err === 0 ? 'text-ok' : s.err < 1 ? 'text-warn' : 'text-bad')}>{Math.round(s.err * 100)}% errors</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded bg-ok/25">
          <div className={cn('h-full transition-all', s.err < 1 ? 'bg-warn' : 'bg-bad')} style={{ width: `${s.err * 100}%` }} />
        </div>
        <div className="mt-1 text-[11px] leading-snug text-muted">{s.note}</div>
      </div>
    </div>
  );

  const worst = Math.max(A.err, B.err);

  return (
    <LabFrame
      title="Network partition: AP vs CP registries"
      goal="Pick a registry, cut the network, and watch each side over time. A zone split tests who keeps serving stale data; lost heartbeats (registry cut off, data path fine) test who mass-deregisters healthy instances."
      running={cut}
      onToggle={() => {
        if (cut) {
          setHealed(t);
          setCut(false);
        } else {
          setHealed(null);
          setT(0);
          setCut(true);
        }
      }}
      onReset={reset}
      controls={
        <>
          <Seg label="Registry" value={reg} options={REGS} onChange={change(setReg)} />
          <Seg
            label="Failure"
            value={scen}
            options={[
              { value: 'zone', label: 'zone split', hint: 'zones cannot talk to each other at all' },
              { value: 'hb', label: 'registry loses heartbeats', hint: 'GC pause, ACL change, overloaded registry: instances are healthy' },
            ]}
            onChange={change(setScen)}
          />
          <Seg
            label={`Registry servers (quorum = ⌊n/2⌋+1 = ${majority})`}
            value={servers}
            options={[
              { value: 3, label: '3 servers (2 | 1)' },
              { value: 5, label: '5 servers (3 | 2)' },
            ]}
            onChange={change(setServers)}
          />
          <div className="flex flex-col gap-1.5 font-mono text-[11px]">
            {reg === 'eureka' && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={sp} onChange={(e) => change(setSp)(e.target.checked)} /> self-preservation (enableSelfPreservation)
              </label>
            )}
            {reg === 'consul' && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={stale} onChange={(e) => change(setStale)(e.target.checked)} /> allow stale reads (?stale / DNS allow_stale)
              </label>
            )}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={guard} onChange={(e) => change(setGuard)(e.target.checked)} /> client panic guard (never apply an update that empties the list)
            </label>
          </div>
          <Slider label="simulation speed" value={speed} min={1} max={30} onChange={setSpeed} fmt={(v) => `${v}×`} />
          <div className="flex items-end">
            <Button
              size="sm"
              variant={cut ? 'secondary' : 'primary'}
              icon={<Scissors size={13} />}
              onClick={() => {
                if (cut) {
                  setHealed(t);
                  setCut(false);
                } else {
                  setHealed(null);
                  setT(0);
                  setCut(true);
                }
              }}
            >
              {cut ? 'Heal the network' : 'Cut the network'}
            </Button>
          </div>
        </>
      }
      stats={
        <>
          <Stat label="time since cut" value={cut ? `${Math.floor(t)}s` : healed != null ? `healed @${Math.floor(healed)}s` : '—'} />
          <Stat label="zone A errors" value={`${Math.round(A.err * 100)}%`} tone={A.err === 0 ? 'ok' : A.err < 1 ? 'warn' : 'bad'} />
          <Stat label="zone B errors" value={`${Math.round(B.err * 100)}%`} tone={B.err === 0 ? 'ok' : B.err < 1 ? 'warn' : 'bad'} />
          <Stat
            label="registry writes"
            value={A.writes === 'diverge' ? 'both sides (diverging)' : B.writes === 'down' && A.writes === 'ok' ? 'majority only' : A.writes === 'down' ? 'stalled' : 'ok'}
            tone={A.writes === 'diverge' ? 'warn' : B.writes === 'down' || A.writes === 'down' ? 'warn' : 'ok'}
          />
        </>
      }
      insight={
        !cut && healed == null ? (
          <span>Predict first: under a zone split, which registry keeps sending zone-A clients to zone B? Under lost heartbeats, which one deletes every healthy instance?</span>
        ) : !cut && healed != null ? (
          <span>
            <b>After healing:</b> {healNotes(reg, scen, sp)}
          </span>
        ) : (
          <span>
            {reg === 'eureka' && scen === 'zone' && (sp ? 'AP in action: both sides keep answering and accept registrations, so the two registries diverge. Self-preservation sees half the renewals vanish and stops evicting, so callers keep sending ~50% of calls across a dead link. Zone affinity (preferSameZone) and client retries are what save you.' : 'Without self-preservation Eureka eventually evicts the unreachable zone, but only after lease + eviction + three caches (~3.5 min).')}
            {reg === 'eureka' && scen === 'hb' && (sp ? 'This is what self-preservation is for: losing heartbeats looks like everyone dying. Eureka refuses to believe it and keeps serving the last registry, so traffic is unaffected.' : 'Self-preservation off: Eureka trusts the missing heartbeats and evicts every healthy instance. Callers end up with an empty list and a total outage from a registry-side blip.')}
            {reg === 'consul' && scen === 'zone' && `The majority side (${inA} of ${servers} servers) keeps a leader and updates the catalog in seconds. The minority (${inB}) cannot commit anything. With stale reads it keeps answering from a frozen copy; without them new lookups fail and clients live on caches. CP = correct or unavailable, never wrong-and-confident.`}
            {reg === 'consul' && scen === 'hb' && 'Consul separates membership (peer-to-peer gossip with indirect probes) and health checks (run locally by each agent) from the catalog (Raft). Losing the path to the servers only delays changes; it never kills healthy nodes.'}
            {reg === 'zk' && scen === 'zone' && 'Majority side: zone-B sessions expire after the session timeout and watches remove them, which is correct and fast. Minority side: the ensemble stops serving, and clients run on their last cached list.'}
            {reg === 'zk' && scen === 'hb' && "CP plus session-bound registration means 'cannot hear you' = 'you are dead'. A registry-side blip deletes every ephemeral node and callers drop all endpoints. This is the core of Netflix's and Knewton's argument for AP discovery. Mitigate with client-side panic thresholds (Envoy's healthy_panic_threshold) and never applying an empty update."}
          </span>
        )
      }
    >
      <div className="space-y-2 p-1">
        <div className="relative grid grid-cols-2 gap-6">
          <ZoneCol id="A" s={A} n={inA} />
          <ZoneCol id="B" s={B} n={inB} />
          {cut && scen === 'zone' && (
            <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 -translate-x-1/2 border-l-2 border-dashed border-bad">
              <Scissors size={14} className="-ml-[8px] -mt-1 bg-sunken text-bad" />
            </div>
          )}
        </div>
        <div className="rounded-md border border-line bg-surface p-2">
          <div className="eyebrow mb-1">Timeline after the cut</div>
          <ol className="space-y-0.5">
            {sim.events.map((e, i) => {
              const reached = cut ? t >= e.at : healed != null && healed >= e.at;
              return (
                <li key={i} className={cn('flex gap-2 font-mono text-[10.5px] transition-opacity', reached ? 'opacity-100' : 'opacity-40')}>
                  <span className="w-12 shrink-0 text-right text-faint">t+{e.at}s</span>
                  <span className={cn(reached && (e.tone === 'bad' ? 'text-bad' : e.tone === 'warn' ? 'text-warn' : e.tone === 'ok' ? 'text-ok' : 'text-info'))}>{e.text}</span>
                </li>
              );
            })}
          </ol>
        </div>
        {worst === 1 && cut && <div className="rounded-md border border-bad/50 bg-bad/10 px-2 py-1 font-mono text-[11px] text-bad">Total outage while every instance is healthy: the registry, not the service, took you down.</div>}
      </div>
    </LabFrame>
  );
}
