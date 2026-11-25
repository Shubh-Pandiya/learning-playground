import { Fragment, type ReactNode } from 'react';

/** Renders **bold** and `code` inline markup used in pattern content. */
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    const t = m[0];
    parts.push(
      t.startsWith('**') ? (
        <strong key={i++} className="font-semibold text-ink">
          {t.slice(2, -2)}
        </strong>
      ) : (
        <code key={i++} className="rounded bg-ink/[0.07] px-1 py-px font-mono text-[0.86em] text-ink">
          {t.slice(1, -1)}
        </code>
      ),
    );
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
