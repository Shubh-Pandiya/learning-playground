import { useEffect, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Card, CardHeader, Tag, type Tone } from '@/shared/ui';
import { shortSha, startUpdatePolling, useUpdates, type UpdateStatus } from '../updates';

const stateTone: Record<UpdateStatus['state'], Tone> = {
  disabled: 'neutral',
  idle: 'neutral',
  checking: 'info',
  'up-to-date': 'ok',
  updated: 'ok',
  skipped: 'warn',
  error: 'bad',
};

function ago(iso?: string) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 0) return s > -60 ? 'in <1 min' : `in ${Math.round(-s / 60)} min`;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(iso).toLocaleString();
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wider text-faint">{k}</dt>
      <dd className="min-w-0 font-mono text-xs text-ink">{v}</dd>
    </div>
  );
}

/** Settings card: auto-update status from the dev server + "Check now". */
export function UpdatesCard() {
  const { available, status: s, checking, checkNow } = useUpdates();
  useEffect(startUpdatePolling, []);
  useEffect(() => {
    if (window.location.hash === '#updates') document.getElementById('updates')?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return (
    <Card id="updates" className="mt-4 scroll-mt-20">
      <CardHeader
        eyebrow="Updates"
        title="Auto-update from GitHub"
        description={`While the app runs it checks GitHub every ${s?.intervalMin ?? 30} min and pulls new versions. Pulls never touch your progress (it lives in this browser).`}
        actions={
          available ? (
            <Button size="sm" icon={<RefreshCw size={13} className={checking ? 'animate-spin' : ''} />} onClick={() => void checkNow()} disabled={checking || !s?.enabled}>
              {checking ? 'Checking…' : 'Check now'}
            </Button>
          ) : undefined
        }
      />
      {available === false && (
        <p className="mt-4 text-sm text-muted">
          Auto-update runs with the dev server (<code className="font-mono">npm start</code> /{' '}
          <code className="font-mono">./start.sh</code>); it isn&apos;t available in this build.
        </p>
      )}
      {s && (
        <dl className="mt-4 divide-y divide-line">
          <Row
            k="status"
            v={
              <span className="flex flex-wrap items-center gap-2">
                <Tag tone={stateTone[s.state]} dot>
                  {s.state}
                </Tag>
                {s.reason && <span className="text-muted">{s.reason}</span>}
              </span>
            }
          />
          <Row k="tracking" v={`${s.remote}/${s.branch} · every ${s.intervalMin} min`} />
          <Row
            k="version"
            v={
              <>
                {shortSha(s.currentSha)}
                {s.remoteSha && s.remoteSha !== s.currentSha && (
                  <span className="text-muted">
                    {' '}
                    · GitHub at {shortSha(s.remoteSha)} ({s.behind} behind{s.ahead ? `, ${s.ahead} ahead` : ''})
                  </span>
                )}
              </>
            }
          />
          <Row k="last check" v={ago(s.lastCheck)} />
          {s.enabled && <Row k="next check" v={ago(s.nextCheck)} />}
          {s.lastUpdate && (
            <Row
              k="last update"
              v={
                <div>
                  <div>
                    {shortSha(s.lastUpdate.from)} → {shortSha(s.lastUpdate.to)} · {ago(s.lastUpdate.at)}
                    {s.lastUpdate.installed && <span className="text-muted"> · deps installed</span>}
                    {s.lastUpdate.restarted && <span className="text-muted"> · server restarted</span>}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {s.lastUpdate.commits.slice(0, 8).map((c) => (
                      <li key={c.sha} className="truncate text-muted">
                        <span className="text-faint">{c.sha}</span> {c.subject}
                      </li>
                    ))}
                  </ul>
                </div>
              }
            />
          )}
        </dl>
      )}
    </Card>
  );
}
