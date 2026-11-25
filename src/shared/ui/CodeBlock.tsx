import { Highlight, type PrismTheme } from 'prism-react-renderer';
import { cn } from '../cn';

// Token colors reference theme CSS vars so code follows light/dark mode.
const paperTheme: PrismTheme = {
  plain: { color: 'rgb(var(--c-ink))', backgroundColor: 'transparent' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'rgb(var(--c-faint))', fontStyle: 'italic' } },
    { types: ['keyword', 'operator', 'important'], style: { color: 'rgb(var(--c-accent))' } },
    { types: ['string', 'char', 'attr-value', 'regex'], style: { color: 'rgb(var(--c-ok))' } },
    { types: ['number', 'boolean', 'constant'], style: { color: 'rgb(var(--c-violet))' } },
    { types: ['function', 'class-name', 'builtin'], style: { color: 'rgb(var(--c-info))' } },
    { types: ['punctuation'], style: { color: 'rgb(var(--c-muted))' } },
  ],
};

export interface CodeBlockProps {
  code: string;
  /** Prism language: 'python' | 'typescript' | 'java' | 'go' | 'sql' | 'json' … (default python). */
  language?: string;
  /** 1-based line numbers to highlight (e.g. the line currently executing). */
  highlightLines?: number[];
  /** Per-line inline annotation shown at the right, keyed by 1-based line. */
  annotations?: Record<number, string>;
  showLineNumbers?: boolean;
  className?: string;
}

/** Syntax-highlighted code with optional active-line highlight — ideal for loop tracing. */
export function CodeBlock({ code, language = 'python', highlightLines = [], annotations, showLineNumbers = true, className }: CodeBlockProps) {
  return (
    <Highlight code={code.replace(/\n$/, '')} language={language} theme={paperTheme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={cn('overflow-auto rounded-md bg-sunken py-3 font-mono text-[12.5px] leading-[1.7]', className)}>
          {tokens.map((line, i) => {
            const n = i + 1;
            const active = highlightLines.includes(n);
            const { className: lineClass, ...lineProps } = getLineProps({ line });
            return (
              <div
                key={i}
                {...lineProps}
                className={cn(
                  lineClass,
                  'flex border-l-2 pr-4 transition-colors duration-200',
                  active ? 'border-accent bg-accent/10' : 'border-transparent',
                )}
              >
                {showLineNumbers && (
                  <span className="w-10 shrink-0 select-none pr-3 text-right tabular-nums text-faint">{n}</span>
                )}
                <span className={cn('flex-1 whitespace-pre', !showLineNumbers && 'pl-4')}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
                {annotations?.[n] && <span className="ml-4 shrink-0 text-[11px] text-accent">← {annotations[n]}</span>}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}
