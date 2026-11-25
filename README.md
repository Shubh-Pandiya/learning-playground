# Learning Playground

A local, one-stop mastery hub of interactive, drag-and-drop playgrounds, organised in tracks:

| track | modules | route |
| --- | --- | --- |
| 01 · Algorithms | DSA Patterns (NeetCode) | `/dsa` |
| 02 · Systems | System Design (incl. component internals), Kafka | `/system-design`, `/kafka` |
| 03 · Data Engineering | Advanced SQL (real Postgres in the browser), Data Modelling | `/sql`, `/data-modeling` |

The home page shows progress per module, due spaced reviews, and a **Today** plan that
interleaves due reviews and next steps from every module.

## Start

```bash
./start.sh        # installs deps on first run, then starts and opens the browser
# or
npm start         # if deps are already installed
```

The app runs at **http://localhost:5199** (fixed host + port, `strictPort`). Progress is
saved in your browser's localStorage, which is per-origin — always use this exact URL
or your saved progress won't be visible. Back it up from **Settings → Export progress**.

### One-word command

Add an alias to your shell profile (`~/.zshrc` on macOS):

```bash
echo 'alias playground="/Users/A3182771/Projects/learning-playground/start.sh"' >> ~/.zshrc
source ~/.zshrc
playground
```

Stop the server with `Ctrl+C`.

## Requirements

Node.js 20+ (`brew install node`).

## Scripts

| command | what |
| --- | --- |
| `npm start` | dev server on :5199 and open the browser |
| `npm run dev` | dev server without opening the browser |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run preview` | serve the production build on :5199 |

## Structure

```
src/
  app/                    shell: router, header, home, settings
  shared/                 design system, UI primitives, progress persistence (see src/shared/README.md)
  app/modules.tsx         track/module registry (drives routes, nav, home, settings)
  app/today.ts            Today plan builder + streak/activity store (lp:app:activity)
  modules/dsa/            DSA Patterns              → /dsa/*            (lp:dsa:*)
  modules/system-design/  System Design             → /system-design/*  (lp:sd:*)
  modules/kafka/          Kafka                     → /kafka/*          (lp:kafka:*)
  modules/sql/            Advanced SQL              → /sql/*            (lp:sql:*)
  modules/data-modeling/  Data Modelling            → /data-modeling/*  (lp:dm:*)
```

To add a module: create `src/modules/<name>/index.tsx` (default export), add an entry to
`src/app/modules.tsx`, and add its id/namespace to `src/shared/progress`.

Stack: Vite, React 18, TypeScript (strict), Tailwind CSS, react-router, zustand
(persisted to localStorage under `lp:*` keys), dnd-kit, React Flow (`@xyflow/react`),
framer-motion, and PGlite (`@electric-sql/pglite`, Postgres compiled to WASM, for
real SQL execution in the browser; it adds ~16 MB of wasm/data assets to the build).
