import { useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { useDm } from '../../store';
import type { LabTopic } from '../../types';
import CassandraTab from './CassandraTab';
import DynamoTab from './DynamoTab';
import MongoTab from './MongoTab';

const TABS = [
  { id: 'dynamo', label: 'DynamoDB single-table', sub: 'customers · orders · items', ex: ['dynamo-all-query', 'dynamo-gsi-shard'] },
  { id: 'cassandra', label: 'Cassandra wide rows', sub: 'chat messages', ex: ['cassandra-bounded'] },
  { id: 'mongo', label: 'MongoDB documents', sub: 'posts · authors · comments', ex: ['doc-embed'] },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function NosqlLab({ topic }: { topic: LabTopic }) {
  const [tab, setTab] = useState<TabId>('dynamo');
  const done = useDm((s) => s.topics[topic.id]?.exercises) ?? {};
  const total = topic.exercises.length;
  const n = topic.exercises.filter((e) => done[e.id]).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-paper px-3 py-1.5">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors', tab === t.id ? 'border-accent/50 bg-accent/[0.08]' : 'border-transparent hover:bg-surface')}
          >
            <span className={cn('font-mono text-[11px]', tab === t.id ? 'text-accent' : 'text-faint')}>{i + 1}</span>
            <span>
              <span className={cn('block text-[12.5px] font-semibold leading-tight', tab === t.id ? 'text-ink' : 'text-muted')}>{t.label}</span>
              <span className="block font-mono text-[10px] leading-tight text-faint">{t.sub}</span>
            </span>
            <span className="ml-1 flex gap-0.5">
              {t.ex.map((id) => (done[id] ? <CheckCircle2 key={id} size={12} className="text-ok" /> : <Circle key={id} size={12} className="text-faint" />))}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted">
          <span className="hidden lg:inline">access patterns first → keys second</span>
          <span className={cn('rounded-md border px-2 py-0.5', n === total ? 'border-ok/50 bg-ok/10 text-ok' : 'border-line bg-surface')}>
            {n}/{total} exercises
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {TABS.map((t) => (
          <div key={t.id} className={cn('h-full min-h-0', tab === t.id ? 'block' : 'hidden')}>
            {t.id === 'dynamo' ? <DynamoTab topic={topic} active={tab === t.id} /> : t.id === 'cassandra' ? <CassandraTab topic={topic} active={tab === t.id} /> : <MongoTab topic={topic} active={tab === t.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
