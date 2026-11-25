/** @type {import('tailwindcss').Config} */
// Colors are CSS variables (see src/index.css) so light/dark themes swap without
// per-component `dark:` classes. Use e.g. `bg-paper text-ink border-line`.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        paper: v('paper'), // page background (#f4ebe0 light)
        surface: v('surface'), // cards / panels
        sunken: v('sunken'), // wells, code blocks, canvases
        ink: v('ink'), // primary text
        muted: v('muted'), // secondary text
        faint: v('faint'), // tertiary text, placeholders
        line: v('line'), // borders, dividers
        accent: v('accent'), // brand / primary action (terracotta)
        'accent-ink': v('accent-ink'), // text on accent
        ok: v('ok'), // correct / success
        warn: v('warn'), // tradeoff / caution
        bad: v('bad'), // wrong / anti-pattern
        info: v('info'), // neutral highlight / pointer
        violet: v('violet'), // extra series color (e.g. 2nd pointer)
      },
      fontFamily: {
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
      boxShadow: {
        paper: '0 1px 0 rgb(var(--c-line) / 0.6), 0 8px 24px -12px rgb(var(--c-ink) / 0.18)',
        lift: '0 2px 0 rgb(var(--c-line) / 0.8), 0 16px 32px -16px rgb(var(--c-ink) / 0.28)',
      },
      keyframes: {
        'flow-dash': { to: { strokeDashoffset: '-20' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
      },
      animation: {
        'flow-dash': 'flow-dash 0.8s linear infinite',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
