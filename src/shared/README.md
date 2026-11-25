# `src/shared` — design system & app services

Everything here is shared by all modules: `dsa`, `system-design`, `kafka`, `sql`, `data-modeling`, `de-system-design`.
Import via the `@/` alias (→ `src/`). Don't fork these — extend them.

## Look & feel

Warm "paper" theme inspired by designed-to-scale: beige page (`#f4ebe0`), dark ink
text, JetBrains Mono for headings/labels/UI chrome, Inter for long prose, hairline
borders, calm minimal chrome, generous whitespace. A dark theme is toggled in the
header and persisted (`lp:app:theme`).

**Colors are CSS variables**, so never hardcode hex or use `dark:` — use the tokens
(alpha modifiers work: `bg-ink/5`, `border-accent/30`):

| token | use |
| --- | --- |
| `paper` | page background |
| `surface` | cards, panels |
| `sunken` | canvases, code, wells |
| `ink` / `muted` / `faint` | text: primary / secondary / tertiary |
| `line` | borders, dividers |
| `accent` (+`accent-ink`) | brand / primary highlight (terracotta) |
| `ok` / `warn` / `bad` | correct / tradeoff / wrong |
| `info` / `violet` | neutral highlight, pointers (e.g. `i` = info, `j` = violet) |

Utilities: `.eyebrow` (small uppercase mono label), `.bg-grid` (dotted canvas
backdrop), `animate-flow-dash` (animated dashed SVG edges, set `stroke-dasharray`),
`animate-pulse-soft`, `shadow-paper`, `shadow-lift`. In SVG use
`stroke="rgb(var(--c-accent))"`.

Layout: the app header is `h-14` and sets `--header-h: 3.5rem`; a full-height module
view can use `h-[calc(100vh-var(--header-h))]`. Modules own their page width.

## UI primitives — `import { … } from '@/shared/ui'`

| component | notes |
| --- | --- |
| `Button` | `variant`: primary · secondary · ghost · danger · success; `size`: xs · sm · md · lg; `icon`, `iconOnly` (+`aria-label`), `active` |
| `Card`, `CardHeader` | `interactive` (hover lift), `tone` left border (accent/ok/warn/bad/info), `padded`; header: `eyebrow`, `title`, `description`, `actions` |
| `Panel` | titled section: `title`, `icon`, `actions`, `flush` (no padding), `sunken` (canvas bg) |
| `Tag` / `Badge` | `tone`: neutral · accent · ok · warn · bad · info · violet; `variant`: soft · solid · outline; `dot`, `icon`, `size` |
| `ProgressBar` | `value`, `max` (default 1), `tone`, `label`, `showValue`: 'fraction' · 'percent', `markers` (0..1), animated |
| `Tooltip` | `<Tooltip content="…" side="top"><button/></Tooltip>` — portal, never clipped |
| `Kbd` | `<Kbd>Space</Kbd>` |
| `useStepper(total, { intervalMs, loop })` | step-through state: `step`, `playing`, `speed`, `next/prev/play/pause/toggle/reset/goTo/setSpeed` |
| `StepControls` | `<StepControls stepper={s} caption="i=2 → swap" />` — prev/play/pause/next/reset, speed (0.5–4×), scrubber, ←/→/Space/R shortcuts |
| `SidePanel` | slide-in drawer: `open`, `onClose`, `title`, `eyebrow`, `side`, `widthClassName`, `overlay`, `footer`; Esc closes |
| `Callout` | feedback box `tone`: info · ok · warn · bad · tip, `title`, children — use for "✓ solves X", "⚠ tradeoff", "✗ why this is wrong" |
| `CodeBlock` | prism highlighting, `language`, `highlightLines` (active line while tracing), `annotations` ({line: 'i=3'}) |
| `ThemeToggle` | already in the header |

Also `cn(...)` from `@/shared/cn` (clsx).

Typical step-through:

```tsx
const frames = useMemo(() => traceTwoSum(nums, target), [nums, target]);
const s = useStepper(frames.length, { intervalMs: 800 });
const f = frames[s.step];
<CodeBlock code={src} highlightLines={[f.line]} />
<StepControls stepper={s} caption={f.explain} />
```

## Progress persistence — `import { … } from '@/shared/progress'`

All progress lives in `localStorage` under `lp:<namespace>:<name>`
(namespaces: `dsa`, `sd` (system design), `kafka`, `sql`, `dm` (data modelling), `desd` (data-engineering system design), `app`). The dev server is pinned
to `http://localhost:5199` because localStorage is per-origin.

```ts
// a persisted zustand store at lp:dsa:progress
export const useDsaProgress = createPersistedStore('dsa', 'progress', (set) => ({
  solved: {} as Record<string, boolean>,
  markSolved: (id: string) => set((s) => ({ solved: { ...s.solved, [id]: true } })),
}), { version: 1 /*, migrate, partialize */ });
```

**Report to the home page** (it shows these without loading your bundle; stored at
`lp:app:summaries`). Call once near your module root, derived from your store:

```ts
useReportProgress('dsa', {
  completed: solvedCount, total: 150, unit: 'problems',
  detail: '7 / 18 patterns started', dueForReview: 3,
  resume: { label: 'Two Pointers · 3Sum', path: '/dsa/problem/3sum' },
});
// or imperatively: reportProgress('system-design', {...})
```

Module ids (`ModuleId`): `'dsa' | 'system-design' | 'kafka' | 'sql' | 'data-modeling' | 'de-system-design'`.

### Feeding the home "Today" plan

Add `reviews` and `nextSteps` (both `PlanItem[]`, optional) to the same summary:

```ts
type PlanItem = {
  label: string;           // 'Window functions: RANK vs DENSE_RANK'
  path: string;            // deep link into your module
  kind?: 'review' | 'learn' | 'practice' | 'challenge';
  minutes?: number;        // estimate; defaults 5 / 15 / 20 / 25 by kind
  detail?: string;         // one short line of context
};

useReportProgress('sql', {
  completed, total, unit: 'concepts', dueForReview: due.length,
  reviews: due.slice(0, 5).map((c) => ({ label: c.title, path: `/sql/review/${c.id}` })),
  nextSteps: [{ label: 'Recursive CTEs', path: '/sql/learn/recursive-cte', kind: 'learn', minutes: 15 }],
});
```

How Today is built (`src/app/today.ts`): due reviews first, round-robin across
modules (interleaving, max 6). If `dueForReview` exceeds the listed `reviews`, a
"N more reviews due" item links to `resume`. Then next steps (max 3): one per track
(Algorithms → Systems → Data), using the least-progressed module's first `nextSteps`
item (falling back to `resume`). Ties rotate daily, so every module gets turns. Leftover
slots go to other modules, then to a suggestion to start an untouched one. Keep the list short and send only the most useful
items. Users can tick items off for the day (`lp:app:activity`, which also tracks the
day streak).

Spaced repetition helpers: `newCard()`, `review(card, grade 0..3)`, `isDue(card)` —
store `ReviewCard`s in your own store.

Export / Import / Reset of every `lp:*` key is handled by the Settings page
(`exportProgress`, `importProgress`, `resetProgress(namespace?)`, `listStorageKeys`).
Keep all module state JSON-serialisable so it round-trips. The Settings reset buttons
are generated from the registry in `src/app/modules.tsx`.

## Real SQL in the browser — PGlite

`@electric-sql/pglite` (Postgres compiled to WASM) is installed and configured in
`vite.config.ts` (`optimizeDeps.exclude`, `worker.format: 'es'`).

```ts
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();                       // in-memory; ~1.5–2 s cold start
const { rows, fields } = await db.query('select 41 + 1 as answer');
await db.exec('create table t(id int); insert into t values (1),(2);');
```

Create **one** instance lazily (module-level promise) and reuse it; load it only inside
the module that needs it so other routes stay light. `EXPLAIN (FORMAT JSON)` works for
query-plan visuals. Build warnings about `eval` in PGlite are expected.
