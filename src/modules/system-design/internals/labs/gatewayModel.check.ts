/**
 * Focused checks for the gateway filter-chain model (not bundled).
 * Run from the repo root:
 *   node -e "require('jiti')(process.cwd()+'/x.js',{alias:{'@':process.cwd()+'/src'}})('./src/modules/system-design/internals/labs/gatewayModel.check.ts')"
 */
import { DEFAULT_RATES, evaluate, REFERENCE, type F } from './gatewayModel';

const fails: string[] = [];
const check = (name: string, ok: boolean) => {
  if (!ok) fails.push(name);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
};
const issue = (chain: F[], scope: 'shared' | 'public', re: RegExp) => evaluate(chain, DEFAULT_RATES, scope).issues.some((i) => re.test(i.text));
const good = (chain: F[], scope: 'shared' | 'public', re: RegExp) => evaluate(chain, DEFAULT_RATES, scope).good.some((g) => re.test(g));

const cacheBeforeAuthz: F[] = ['cors', 'ip-limit', 'authn', 'user-limit', 'cache', 'authz', 'validate', 'router'];
const noAuthz: F[] = ['cors', 'ip-limit', 'authn', 'user-limit', 'validate', 'cache', 'router'];
const cacheFirst: F[] = ['cors', 'cache', 'ip-limit', 'authn', 'user-limit', 'authz', 'validate', 'router'];
const quotaFirst: F[] = ['cors', 'user-limit', 'ip-limit', 'authn', 'authz', 'validate', 'cache', 'router'];

// reference order is clean in both scopes
for (const scope of ['shared', 'public'] as const) {
  const ev = evaluate(REFERENCE, DEFAULT_RATES, scope);
  check(`reference (${scope}): no issues, no leaks, no unauthorized traffic served`, ev.issues.length === 0 && ev.leaked === 0 && ev.backendAbuse < 100);
}

// protected cache after AuthN but before AuthZ: authorization bypass
{
  const ev = evaluate(cacheBeforeAuthz, DEFAULT_RATES, 'shared');
  check('shared cache before AuthZ leaks to valid-but-unauthorized callers', (ev.leakedBy.forbidden ?? 0) > 0);
  check('shared cache before AuthZ: authenticated-only leak (no anonymous leak)', !ev.leakedBy.badtoken && !ev.leakedBy.flood);
  check('shared cache before AuthZ is flagged as an authorization bypass', issue(cacheBeforeAuthz, 'shared', /before AuthZ.*authorization bypass/));
}
// no AuthZ at all: also a bypass via the cache, plus a missing-authz warning
{
  const ev = evaluate(noAuthz, DEFAULT_RATES, 'shared');
  check('no AuthZ + shared cache leaks to unauthorized callers', (ev.leakedBy.forbidden ?? 0) > 0);
  check('no AuthZ is flagged', issue(noAuthz, 'shared', /No AuthZ at the gateway/));
  check('no AuthZ: unauthorized requests reach the backend', ev.backendAbuse > DEFAULT_RATES.forbidden * 0.5);
}
// protected cache before AuthN: anonymous leak (existing behaviour kept)
{
  const ev = evaluate(cacheFirst, DEFAULT_RATES, 'shared');
  check('shared cache before AuthN leaks to anonymous callers', (ev.leakedBy.badtoken ?? 0) + (ev.leakedBy.flood ?? 0) > 0);
  check('shared cache before AuthN is flagged', issue(cacheFirst, 'shared', /before AuthN/));
}
// public-only cache ahead of auth stays legitimate
for (const chain of [cacheFirst, cacheBeforeAuthz]) {
  const ev = evaluate(chain, DEFAULT_RATES, 'public');
  check(`public cache at position ${chain.indexOf('cache')}: no leak, no cache issue`, ev.leaked === 0 && !ev.issues.some((i) => /cache/i.test(i.text)));
  check(`public cache at position ${chain.indexOf('cache')}: explained as legitimate`, good(chain, 'public', /Public-only cache/));
}
// a public cache never serves protected resources, so unauthorized callers still hit AuthZ
check('public cache: unauthorized requests still rejected at AuthZ', (evaluate(cacheBeforeAuthz, DEFAULT_RATES, 'public').rejectedAt.authz ?? 0) >= DEFAULT_RATES.forbidden - 1e-6);
// identity-based quota needs verified identity; coarse IP limit first is fine
check('user quota before AuthN is flagged', issue(quotaFirst, 'shared', /User quota runs before identity is verified/));
check('IP limit before AuthN is not flagged', !issue(REFERENCE, 'shared', /IP limit/));
check('IP limit after AuthN is flagged', issue(['cors', 'authn', 'ip-limit', 'user-limit', 'authz', 'validate', 'cache', 'router'], 'shared', /IP limit after AuthN/));

if (fails.length) throw new Error(`${fails.length} gateway model check(s) failed:\n${fails.join('\n')}`);
console.log('GATEWAY MODEL OK');
