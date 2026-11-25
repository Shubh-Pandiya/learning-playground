#!/usr/bin/env node
// `npm start` entry: runs Vite and restarts it when the auto-updater asks
// (exit code 75 after pulling config/dependency changes). Extra args go to Vite.
// LP_NO_OPEN=1 skips opening the browser.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESTART_EXIT_CODE = 75;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const extra = process.argv.slice(2);

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

launch();
