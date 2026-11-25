import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function PageBar({ back = '/kafka', backLabel = 'Kafka', eyebrow, title, children }: { back?: string; backLabel?: string; eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-paper px-4">
      <Link to={back} className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
        <ArrowLeft size={14} /> {backLabel}
      </Link>
      <div className="h-5 w-px bg-line" />
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow leading-none">{eyebrow}</div>}
        <div className="truncate font-mono text-[13.5px] font-semibold leading-tight">{title}</div>
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
