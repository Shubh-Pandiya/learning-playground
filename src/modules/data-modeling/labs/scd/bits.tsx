import { motion } from 'framer-motion';
import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/shared/cn';
import { CodeBlock } from '@/shared/ui';
import { Rich } from '../../ui/Rich';

export function ExerciseChecklist({ items, done }: { items: { id: string; title: string }[]; done: Record<string, boolean> | undefined }) {
  const n = items.filter((e) => done?.[e.id]).length;
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Exercises</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {n}/{items.length}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10">
        <motion.div className="h-full bg-ok" initial={false} animate={{ width: `${(n / items.length) * 100}%` }} />
      </div>
      <ul className="mt-2 space-y-1">
        {items.map((e) => (
          <li key={e.id} className={cn('flex items-start gap-1.5 text-[12.5px]', done?.[e.id] ? 'text-ink' : 'text-muted')}>
            {done?.[e.id] ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={14} className="mt-0.5 shrink-0 text-faint" />}
            <span>{e.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HoodSection({ title, body, code, language = 'sql' }: { title: string; body: string[]; code?: string; language?: string }) {
  return (
    <details className="group rounded-xl border border-line bg-surface open:shadow-paper">
      <summary className="cursor-pointer list-none px-3 py-2 font-mono text-[12.5px] font-semibold text-ink marker:hidden">
        <span className="mr-1.5 inline-block text-accent transition group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2.5">
        {body.map((b, i) => (
          <p key={i} className="text-[12.5px] leading-relaxed text-muted">
            <Rich text={b} />
          </p>
        ))}
        {code && <CodeBlock code={code} language={language} className="text-[11.5px]" />}
      </div>
    </details>
  );
}
