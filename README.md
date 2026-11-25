# Learning Playground

Drag-and-drop playgrounds for DSA patterns (NeetCode) and System Design.

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
  modules/dsa/            DSA Patterns Playground   → /dsa/*
  modules/system-design/  System Design Playground  → /system-design/*
```

Stack: Vite, React 18, TypeScript (strict), Tailwind CSS, react-router, zustand
(persisted to localStorage under `lp:*` keys), dnd-kit, React Flow (`@xyflow/react`),
framer-motion.
