import { Fragment, type ReactNode } from 'react';

/** Renders **bold** and `code` inline markup used in lesson content. */
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    const t = m[0];
    if (t.startsWith('**'))
      parts.push(
        <strong key={i++} className="font-semibold text-ink">
          {t.slice(2, -2)}
        </strong>,
      );
    else if (t.startsWith('`'))
      parts.push(
        <code key={i++} className="rounded bg-ink/[0.07] px-1 py-px font-mono text-[0.86em] text-ink">
          {t.slice(1, -1)}
        </code>,
      );
    else parts.push(<em key={i++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
