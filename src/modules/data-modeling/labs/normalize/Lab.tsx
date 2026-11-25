import { useState } from 'react';
import { cn } from '@/shared/cn';
import type { LabTopic } from '../../types';
import { Anomalies } from './Anomalies';
import { Hood } from './Hood';
import { Normalize } from './Normalize';
import { Practice } from './Practice';
import { Checklist } from './ui';

type Tab = 'anomalies' | 'normalize' | 'practice' | 'hood';

const TABS: { id: Tab; label: string }[] = [
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'normalize', label: '0NF → BCNF' },
  { id: 'practice', label: 'Practice' },
  { id: 'hood', label: 'Under the hood' },
];

export default function NormalizeLab({ topic }: { topic: LabTopic }) {
  const [tab, setTab] = useState<Tab>('anomalies');

  const header = (
    <div className="border-b border-line p-2">
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-sunken p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-md px-1 py-1.5 text-[11.5px] font-medium transition-colors',
              tab === t.id ? 'bg-surface text-ink shadow-paper' : 'text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
  const footer = <Checklist topic={topic} />;
  const props = { topic, header, footer };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className={cn('h-full min-h-0', tab !== 'anomalies' && 'hidden')}>
        <Anomalies {...props} />
      </div>
      <div className={cn('h-full min-h-0', tab !== 'normalize' && 'hidden')}>
        <Normalize {...props} />
      </div>
      <div className={cn('h-full min-h-0', tab !== 'practice' && 'hidden')}>
        <Practice {...props} />
      </div>
      <div className={cn('h-full min-h-0', tab !== 'hood' && 'hidden')}>
        <Hood {...props} />
      </div>
    </div>
  );
}
