import { useRef, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import {
  exportProgress,
  importProgress,
  listStorageKeys,
  resetProgress,
  type ProgressNamespace,
} from '@/shared/progress';
import { Button, Callout, Card, CardHeader, Tag, type Tone } from '@/shared/ui';
import { allModules } from '../modules';

type Status = { tone: 'ok' | 'bad'; text: string } | null;

const resetTargets: { ns?: ProgressNamespace; label: string; hint: string }[] = [
  ...allModules.map((m) => ({ ns: m.namespace, label: `Reset ${m.short}`, hint: `lp:${m.namespace}:*` })),
  { ns: undefined, label: 'Reset everything', hint: 'lp:* (incl. theme, streak & home summaries)' },
];

const nsTone: Partial<Record<string, Tone>> = { dsa: 'info', sd: 'violet', kafka: 'warn', sql: 'ok', dm: 'accent' };

function bytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function reloadSoon() {
  setTimeout(() => window.location.reload(), 600);
}

export default function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const keys = listStorageKeys();

  const onExport = () => {
    const payload = exportProgress();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learning-playground-progress-${payload.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ tone: 'ok', text: `Exported ${Object.keys(payload.data).length} keys.` });
  };

  const onImportFile = async (file: File) => {
    try {
      const n = importProgress(JSON.parse(await file.text()));
      setStatus({ tone: 'ok', text: `Imported ${n} keys. Reloading…` });
      reloadSoon();
    } catch (e) {
      setStatus({ tone: 'bad', text: e instanceof Error ? e.message : 'Import failed.' });
    }
  };

  const onReset = (ns: ProgressNamespace | undefined, label: string) => {
    if (confirming !== label) {
      setConfirming(label);
      return;
    }
    const n = resetProgress(ns);
    setConfirming(null);
    setStatus({ tone: 'ok', text: `Removed ${n} keys. Reloading…` });
    reloadSoon();
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="eyebrow">Settings</p>
      <h1 className="mt-2 text-2xl font-semibold">Your progress</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        Progress is saved automatically in this browser's localStorage for{' '}
        <code className="font-mono text-ink">{window.location.origin}</code>. Export a backup to move it to
        another browser or keep it safe.
      </p>

      {status && (
        <Callout tone={status.tone} className="mt-6">
          {status.text}
        </Callout>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader eyebrow="Backup" title="Export progress" description="Download every saved key as a JSON file." />
          <Button className="mt-4" variant="primary" icon={<Download size={14} />} onClick={onExport}>
            Download JSON
          </Button>
        </Card>
        <Card>
          <CardHeader
            eyebrow="Restore"
            title="Import progress"
            description="Replace current progress with a previously exported file."
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
          <Button className="mt-4" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
            Choose file…
          </Button>
        </Card>
      </div>

      <Card className="mt-4" tone="bad">
        <CardHeader eyebrow="Danger zone" title="Reset" description="Click once, then click again to confirm." />
        <div className="mt-4 flex flex-wrap gap-2">
          {resetTargets.map((t) => (
            <Button
              key={t.label}
              variant="danger"
              size="sm"
              icon={<RotateCcw size={13} />}
              onClick={() => onReset(t.ns, t.label)}
              title={t.hint}
            >
              {confirming === t.label ? 'Click again to confirm' : t.label}
            </Button>
          ))}
        </div>
      </Card>

      <section className="mt-10">
        <h2 className="eyebrow">Stored keys ({keys.length})</h2>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
          {keys.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nothing saved yet.</li>}
          {keys.map((k) => (
            <li key={k} className="flex items-center gap-3 px-4 py-2.5 font-mono text-xs">
              <Tag tone={nsTone[k.split(':')[1]] ?? 'neutral'}>
                {k.split(':')[1]}
              </Tag>
              <span className="flex-1 truncate">{k}</span>
              <span className="tabular-nums text-faint">{bytes((localStorage.getItem(k) ?? '').length)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
