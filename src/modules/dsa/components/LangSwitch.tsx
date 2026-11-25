import { motion } from 'framer-motion';
import { Code2 } from 'lucide-react';
import { cn } from '@/shared/cn';
import { LANGS, type Lang } from '../engine/types';
import { LANG_META } from '../lang/code';
import { useLang, useLangStore } from '../lang/store';

/** Compact segmented control: Python · Java · C++. */
export function LangSwitch({ className, size = 'sm' }: { className?: string; size?: 'xs' | 'sm' }) {
  const lang = useLang();
  const setLang = useLangStore((s) => s.setLang);
  return (
    <div role="radiogroup" aria-label="Code language" className={cn('inline-flex items-center rounded-lg border border-line bg-surface p-0.5', className)}>
      {LANGS.map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          onClick={() => setLang(l)}
          className={cn(
            'rounded-md font-mono transition-colors',
            size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
            lang === l ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
          )}
        >
          {LANG_META[l].label}
        </button>
      ))}
    </div>
  );
}

const SAMPLES: Record<Lang, string> = {
  python: 'seen = {}\nfor i, n in enumerate(nums):\n    if target - n in seen:',
  java: 'Map<Integer, Integer> seen = new HashMap<>();\nfor (int i = 0; i < nums.length; i++) {\n    if (seen.containsKey(target - nums[i])) {',
  cpp: 'unordered_map<int, int> seen;\nfor (int i = 0; i < nums.size(); i++) {\n    if (seen.count(target - nums[i])) {',
};

/** First-visit modal: the learner picks the language they will interview in. */
export function LangPicker() {
  const chosen = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  if (chosen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lang-picker-title"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-3xl rounded-2xl border border-line bg-paper p-6 shadow-paper"
      >
        <div className="eyebrow flex items-center gap-2">
          <Code2 className="h-3.5 w-3.5" /> one-time setup
        </div>
        <h2 id="lang-picker-title" className="mt-1 font-mono text-xl font-semibold text-ink">
          Which language will you interview in?
        </h2>
        <p className="mt-1 text-sm text-muted">
          Every template, solution, step-through and drag-and-drop block will use it. You can switch any time from the DSA bar or a problem page.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className="group rounded-xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="font-mono text-base font-semibold text-ink group-hover:text-accent">{LANG_META[l].label}</div>
              <pre className="mt-2 overflow-hidden whitespace-pre font-mono text-[10.5px] leading-4 text-muted">{SAMPLES[l]}</pre>
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/** Bulleted gotchas; `backticked` spans render as inline code. */
export function GotchaList({ items }: { items: string[] }) {
  return (
    <ul className="ml-4 list-disc space-y-1">
      {[...new Set(items)].map((g) => (
        <li key={g}>
          {g.split(/(`[^`]+`)/).map((part, i) =>
            part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
              <code key={i} className="rounded bg-sunken px-1 font-mono text-[0.9em] text-ink">
                {part.slice(1, -1)}
              </code>
            ) : (
              part
            ),
          )}
        </li>
      ))}
    </ul>
  );
}
