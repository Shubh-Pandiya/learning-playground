#!/usr/bin/env node
// `npm start` entry: runs Vite and restarts it when the auto-updater asks
// (exit code 75 after pulling config/dependency changes). Extra args go to Vite.
// LP_NO_OPEN=1 skips opening the browser.
// Before launching it checks the Node version and (re)installs dependencies when Vite is
// missing or package-lock.json changed, so `npm start` works right after a fresh clone.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESTART_EXIT_CODE = 75;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const extra = process.argv.slice(2);

// Vite 8 requires Node ^20.19.0 || >=22.12.0.
function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
  if (ok) return;
  console.error(
    `\n[start] Node.js ${process.versions.node} is too old. Learning Playground needs Node 20.19+ or 22.12+.\n` +
      '        Install the current LTS from https://nodejs.org (macOS: brew install node), then run npm start again.\n',
  );
  process.exit(1);
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Fresh clone (no node_modules), a partial/prod-only install (no Vite), or a lockfile newer
// than the last install (e.g. after git pull) → npm install, always including devDependencies.
function ensureDeps() {
  const lock = path.join(root, 'package-lock.json');
  const installed = path.join(root, 'node_modules', '.package-lock.json');
  const reason = !fs.existsSync(viteBin)
    ? 'dependencies are not installed'
    : mtime(lock) > mtime(installed)
      ? 'package-lock.json changed'
      : null;
  if (!reason) return;

  console.log(`[start] ${reason} → npm install (first run can take a minute)…`);
  const args = ['install', '--include=dev', '--no-fund', '--no-audit'];
  // Prefer the npm that launched us (npm start); otherwise find npm on PATH (npm.cmd needs a shell on Windows).
  const npmCli = process.env.npm_execpath;
  const res =
    npmCli && /npm-cli\.[cm]?js$/.test(npmCli)
      ? spawnSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: 'inherit' })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
          cwd: root,
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
  if (res.status !== 0 || !fs.existsSync(viteBin)) {
    console.error(
      '\n[start] npm install failed' + (res.error ? `: ${res.error.message}` : '') + '.\n' +
        '        Fix the error above, then run:  npm install --include=dev  &&  npm start\n',
    );
    process.exit(1);
  }
  // npm may leave the hidden lockfile untouched when nothing changed; mark this install as current.
  const now = new Date();
  try {
    fs.utimesSync(installed, now, now);
  } catch {}
}

let child;
let stopping = false;
let launches = 0;
const recent = [];

function launch() {
  const open = launches === 0 && process.env.LP_NO_OPEN !== '1' && !extra.includes('--open');
  launches++;
  child = spawn(process.execPath, [viteBin, ...(open ? ['--open'] : []), ...extra], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, LP_SUPERVISED: '1' },
  });
  child.on('exit', (code, signal) => {
    if (!stopping && code === RESTART_EXIT_CODE) {
      const now = Date.now();
      recent.push(now);
      while (recent.length && now - recent[0] > 60_000) recent.shift();
      if (recent.length > 5) {
        console.error('[start] Vite asked to restart too often; giving up. Run `npm start` again.');
        process.exit(1);
      }
      console.log('[start] restarting Vite to apply the update…');
      launch();
      return;
    }
    process.exit(code ?? (signal ? 130 : 0));
  });
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    stopping = true;
    child?.kill(sig);
  });
}

checkNode();
ensureDeps();
launch();
