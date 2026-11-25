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

On a fresh laptop (needs **Node.js 20.19+ or 22.12+** and git; macOS: `brew install node`,
otherwise https://nodejs.org):

```bash
git clone https://github.com/Shubh-Pandiya/learning-playground.git
cd learning-playground
./start.sh        # macOS / Linux
# or: npm start   # any OS
# or: start.cmd   # Windows (double-click or run in cmd)
```

All three do the same thing:
1. Check the Node version.
2. Run `npm install --include=dev` if dependencies are missing, incomplete or out of date
   (package-lock.json changed). This also works when your npm is set to skip devDependencies
   (`NODE_ENV=production`, `omit=dev`).
3. Start the app and open the browser.

If `./start.sh` finds the app already running on :5199, it just opens the browser.

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

## Automatic updates from GitHub

While the app is running (`./start.sh` / `npm start`), it keeps itself up to date with
`origin/main` (https://github.com/Shubh-Pandiya/learning-playground). This works on any
laptop with a clone, and no GitHub login is needed because the repo is public.

- It checks 3 s after start and then **every 30 minutes**: `git fetch origin main`.
- If there are new commits, it runs `git pull --ff-only` (fast-forward only), and the page reloads via HMR.
  - If `package.json` or `package-lock.json` changed, it runs `npm install --include=dev`.
  - If `package.json`/the lockfile, `vite.config.ts`, Tailwind/PostCSS config, `tsconfig.json` or `scripts/` changed, the dev server restarts automatically.
- A small toast shows **"Updated to abc1234 — What's new"** with the pulled commits.
- **It never overwrites your work.** It skips the pull and shows an "update skipped"
  badge in the header if any of these hold:
  - you have uncommitted changes to tracked files,
  - your local `main` has commits that aren't on GitHub (diverged),
  - you're on a branch other than `main`.
- Offline, or no `origin` remote: it reports the error/disabled state and retries on the next tick.
- **Your progress is never touched by updates.** It lives in the browser's localStorage, not in the repo.
- **Settings → Updates** shows the status (current/remote commit, last/next check, last
  update) and has a **Check now** button. Raw status: `GET /__updates`; trigger a check:
  `POST /__updates/check`.

| env var | default | effect |
| --- | --- | --- |
| `LP_AUTO_UPDATE` | `1` | `0` disables the updater |
| `LP_UPDATE_INTERVAL_MIN` | `30` | minutes between checks |
| `LP_NO_OPEN` | — | `1` = don't open the browser on start |

How it works:
- `npm start` runs `scripts/start.mjs`, a tiny supervisor around Vite. It relaunches Vite when
  the updater asks for a restart (exit code 75).
- The updater itself is a Vite dev-server plugin in `scripts/auto-update.ts`, so it is not part of `npm run build` output.
- With `npm run dev` the updater also runs, and it restarts Vite in-process instead.

## Requirements

Node.js 20.19+ or 22.12+ (required by Vite 8; declared in `package.json` `engines`). On macOS: `brew install node`.

If you see `Cannot find module …/node_modules/vite/bin/vite.js`, you are on an older checkout. Run `git pull`, or `npm install --include=dev`, then start again.

## Scripts

| command | what |
| --- | --- |
| `npm start` | dev server on :5199 + auto-updater, opens the browser (supervised: restarts after updates) |
| `npm run dev` | dev server (with auto-updater) without opening the browser |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run preview` | serve the production build on :5199 |

## Structure

```
src/
  app/                    shell: router, header, home, settings, update toast/status (app/updates.ts)
scripts/
  start.mjs               `npm start` supervisor (relaunches Vite after config/dep updates)
  auto-update.ts          GitHub auto-update Vite plugin (/__updates)
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
