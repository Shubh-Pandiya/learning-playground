/**
 * Auto-update for the dev server (`npm start` / `./start.sh`).
 *
 * Every LP_UPDATE_INTERVAL_MIN minutes (default 30) it fetches `origin/main`. If this
 * checkout is on `main`, clean and strictly behind, it fast-forwards. It runs
 * `npm install` when package.json or the lockfile changed, and restarts when config,
 * dependencies or these scripts changed. Source-only changes reach the browser via Vite HMR.
 * It never touches local commits, uncommitted edits or progress (progress lives in
 * the browser's localStorage, not in the repo).
 *
 * Status: GET /__updates · manual check: POST /__updates/check · HMR event `lp:update`.
 * Env: LP_AUTO_UPDATE=0 disables · LP_UPDATE_INTERVAL_MIN · LP_UPDATE_REMOTE (origin)
 *      · LP_UPDATE_BRANCH (main). Restart = exit code 75 when run under scripts/start.mjs.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'updated' | 'skipped' | 'error';

export interface UpdateCommit {
  sha: string;
  subject: string;
}

export interface UpdateStatus {
  enabled: boolean;
  state: UpdateState;
  /** Human-readable explanation for disabled / skipped / error / up-to-date. */
  reason?: string;
  remote: string;
  branch: string;
  intervalMin: number;
  currentSha?: string;
  remoteSha?: string;
  ahead: number;
  behind: number;
  lastCheck?: string;
  nextCheck?: string;
  lastUpdate?: {
    from: string;
    to: string;
    at: string;
    commits: UpdateCommit[];
    installed: boolean;
    restarted: boolean;
  };
}

export const RESTART_EXIT_CODE = 75;

/** Files whose change needs a fresh server process (HMR can't apply them). */
const RESTART_PATTERNS = [
  /^package(-lock)?\.json$/,
  /^vite\.config\.ts$/,
  /^tailwind\.config\.js$/,
  /^postcss\.config\.js$/,
  /^tsconfig\.json$/,
  /^scripts\//,
];
const INSTALL_PATTERNS = [/^package(-lock)?\.json$/];

class CmdError extends Error {
  constructor(
    message: string,
    readonly code?: string | number | null,
  ) {
    super(message);
  }
}

function run(cmd: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        // .cmd shims (npm.cmd) need a shell on Windows; git.exe must not get one (its args contain %).
        shell: cmd.endsWith('.cmd'),
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes',
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message).toString().trim().split('\n').slice(-3).join(' ');
          reject(new CmdError(msg, (err as NodeJS.ErrnoException).code));
        } else resolve(stdout.toString().trim());
      },
    );
  });
}

export interface UpdaterOptions {
  cwd: string;
  remote?: string;
  branch?: string;
  intervalMin?: number;
  enabled?: boolean;
  log?: (msg: string) => void;
  /** Called after a successful update; `restart` = config/deps/scripts changed. */
  onUpdated?: (status: UpdateStatus, restart: boolean) => void;
}

export function createUpdater(opts: UpdaterOptions) {
  const cwd = opts.cwd;
  const remote = opts.remote ?? 'origin';
  const branch = opts.branch ?? 'main';
  const intervalMin = Math.max(0.05, opts.intervalMin ?? 30);
  const enabled = opts.enabled ?? true;
  const log = opts.log ?? (() => {});
  const git = (...args: string[]) => run('git', args, cwd);
  const remoteRef = `refs/remotes/${remote}/${branch}`;

  let stateFile: string | undefined;
  const status: UpdateStatus = {
    enabled,
    state: enabled ? 'idle' : 'disabled',
    reason: enabled ? undefined : 'Disabled with LP_AUTO_UPDATE=0',
    remote,
    branch,
    intervalMin,
    ahead: 0,
    behind: 0,
  };
  let inflight: Promise<UpdateStatus> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;

  async function init() {
    try {
      const gitDir = await git('rev-parse', '--absolute-git-dir');
      stateFile = path.join(gitDir, 'lp-auto-update.json');
      if (existsSync(stateFile)) {
        const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as Pick<UpdateStatus, 'lastUpdate'>;
        if (saved.lastUpdate) status.lastUpdate = saved.lastUpdate;
      }
      status.currentSha = await git('rev-parse', 'HEAD');
    } catch {
      /* not a git checkout: reported by check() */
    }
  }

  function save() {
    if (!stateFile) return;
    try {
      writeFileSync(stateFile, JSON.stringify({ lastUpdate: status.lastUpdate }, null, 2));
    } catch {
      /* best effort */
    }
  }

  function finish(state: UpdateState, reason?: string): UpdateStatus {
    status.state = state;
    status.reason = reason;
    status.lastCheck = new Date().toISOString();
    if (enabled && timer) status.nextCheck = new Date(Date.now() + intervalMin * 60_000).toISOString();
    return { ...status };
  }

  async function doCheck(): Promise<UpdateStatus> {
    if (!enabled) return { ...status };
    status.state = 'checking';

    try {
      await git('rev-parse', '--is-inside-work-tree');
    } catch (e) {
      const missing = e instanceof CmdError && e.code === 'ENOENT';
      return finish('disabled', missing ? 'git is not installed' : 'Not a git checkout (clone the repo to get auto-updates)');
    }
    try {
      await git('remote', 'get-url', remote);
    } catch {
      return finish('disabled', `No "${remote}" remote configured`);
    }

    try {
      await run('git', ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${branch}:${remoteRef}`], cwd, 90_000);
    } catch (e) {
      return finish('error', `Could not reach ${remote} (offline?): ${(e as Error).message}`);
    }

    try {
      status.currentSha = await git('rev-parse', 'HEAD');
      status.remoteSha = await git('rev-parse', remoteRef);
      const [ahead, behind] = (await git('rev-list', '--left-right', '--count', `HEAD...${remoteRef}`))
        .split(/\s+/)
        .map(Number);
      status.ahead = ahead;
      status.behind = behind;

      if (behind === 0) {
        return finish('up-to-date', ahead > 0 ? `${ahead} local commit(s) not on ${remote} yet` : undefined);
      }
      const current = await git('rev-parse', '--abbrev-ref', 'HEAD');
      if (current !== branch) {
        return finish('skipped', `On branch "${current}"; auto-update only follows "${branch}"`);
      }
      if (ahead > 0) {
        return finish('skipped', `Diverged: ${ahead} local commit(s) not on ${remote}. Pull manually.`);
      }
      const dirty = (await git('status', '--porcelain', '--untracked-files=no')).split('\n').filter(Boolean);
      if (dirty.length) {
        return finish('skipped', `Local uncommitted changes in ${dirty.length} file(s). Commit or stash them to receive updates.`);
      }

      const from = status.currentSha;
      const commits = (await git('log', '--format=%h%x09%s', '-n', '30', `HEAD..${remoteRef}`))
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [sha, ...rest] = l.split('\t');
          return { sha, subject: rest.join('\t') };
        });
      const changed = (await git('diff', '--name-only', 'HEAD', remoteRef)).split('\n').filter(Boolean);

      await git('merge', '--ff-only', '--quiet', remoteRef);
      status.currentSha = await git('rev-parse', 'HEAD');
      status.ahead = 0;
      status.behind = 0;
      log(`updated ${from.slice(0, 7)} → ${status.currentSha.slice(0, 7)} (${commits.length} commit(s))`);

      const needsInstall = changed.some((f) => INSTALL_PATTERNS.some((p) => p.test(f)));
      const needsRestart = changed.some((f) => RESTART_PATTERNS.some((p) => p.test(f)));
      if (needsInstall) {
        log('dependencies changed → npm install');
        try {
          await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--include=dev', '--no-audit', '--no-fund'], cwd, 10 * 60_000);
        } catch (e) {
          status.lastUpdate = { from, to: status.currentSha, at: new Date().toISOString(), commits, installed: false, restarted: false };
          save();
          return finish('error', `Updated, but npm install failed: ${(e as Error).message}. Run npm install and restart.`);
        }
      }
      status.lastUpdate = {
        from,
        to: status.currentSha,
        at: new Date().toISOString(),
        commits,
        installed: needsInstall,
        restarted: needsRestart,
      };
      save();
      const result = finish('updated', needsRestart ? 'Restarting the dev server to apply config/dependency changes' : undefined);
      opts.onUpdated?.(result, needsRestart);
      return result;
    } catch (e) {
      return finish('error', (e as Error).message);
    }
  }

  return {
    status: () => ({ ...status }),
    check(): Promise<UpdateStatus> {
      inflight ??= doCheck().finally(() => (inflight = null));
      return inflight;
    },
    async start(initialDelayMs = 3000) {
      await init();
      if (!enabled) return;
      first = setTimeout(() => void this.check(), initialDelayMs);
      timer = setInterval(() => void this.check(), intervalMin * 60_000);
      status.nextCheck = new Date(Date.now() + initialDelayMs).toISOString();
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

export function autoUpdate(): Plugin {
  return {
    name: 'lp-auto-update',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const env = process.env;
      const logger = server.config.logger;
      const log = (m: string) => logger.info(`\x1b[36m[auto-update]\x1b[0m ${m}`, { timestamp: true });
      const supervised = env.LP_SUPERVISED === '1';

      const updater = createUpdater({
        cwd: server.config.root,
        remote: env.LP_UPDATE_REMOTE || 'origin',
        branch: env.LP_UPDATE_BRANCH || 'main',
        intervalMin: env.LP_UPDATE_INTERVAL_MIN ? Number(env.LP_UPDATE_INTERVAL_MIN) || 30 : 30,
        enabled: env.LP_AUTO_UPDATE !== '0',
        log,
        onUpdated: (s, restart) => {
          server.ws.send({ type: 'custom', event: 'lp:update', data: s });
          if (!restart) return;
          if (supervised) {
            log('config/dependencies changed → restarting');
            setTimeout(() => process.exit(RESTART_EXIT_CODE), 300);
          } else {
            log('config/dependencies changed → restarting Vite in-process (use npm start for a full restart)');
            void server.restart();
          }
        },
      });

      server.middlewares.use('/__updates', (req, res, next) => {
        const send = (s: UpdateStatus) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(s));
        };
        const url = (req.url ?? '/').split('?')[0];
        if (req.method === 'GET' && (url === '/' || url === '')) return send(updater.status());
        if (req.method === 'POST' && url === '/check') {
          void updater.check().then(send, (e: Error) => {
            res.statusCode = 500;
            res.end(String(e.message));
          });
          return;
        }
        next();
      });

      void updater.start().then(() => {
        const s = updater.status();
        if (s.enabled) log(`checking ${s.remote}/${s.branch} every ${s.intervalMin} min`);
        else log(s.reason ?? 'disabled');
      });
      server.httpServer?.once('close', () => updater.stop());
    },
  };
}
