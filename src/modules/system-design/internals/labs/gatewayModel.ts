/** Pure model behind GatewayLab: filters, traffic classes and the chain evaluator (no React). */

export type F = 'cors' | 'ip-limit' | 'authn' | 'user-limit' | 'authz' | 'validate' | 'cache' | 'router';
export type C = 'legit' | 'heavy' | 'forbidden' | 'badtoken' | 'flood' | 'preflight';
/** public = only `Cache-Control: public` GETs (catalog, docs); shared = protected responses keyed by route, reused across callers. */
export type CacheScope = 'public' | 'shared';

export const FILTERS: Record<F, { name: string; short: string; ms: number; what: string }> = {
  cors: { name: 'CORS', short: 'cors', ms: 0.005, what: 'Answers browser OPTIONS preflights (204) and adds CORS headers.' },
  'ip-limit': { name: 'IP rate limit', short: 'ip-lim', ms: 0.01, what: 'Coarse per-IP token bucket kept in local memory, so it costs almost nothing. Needs no identity, so it belongs before AuthN.' },
  authn: { name: 'AuthN (JWT)', short: 'authn', ms: 0.08, what: 'Verifies the RS256 signature with a cached JWKS key, then exp/aud/iss. CPU-heavy (~80 µs).' },
  'user-limit': { name: 'User quota', short: 'quota', ms: 0.6, what: 'Global per-user token bucket via Redis / Envoy RLS, keyed on the verified user id: one network RTT per request.' },
  authz: { name: 'AuthZ policy', short: 'authz', ms: 0.15, what: 'Checks scopes, roles and tenant on the verified identity (local OPA / RBAC); 403 if not allowed.' },
  validate: { name: 'Schema validate', short: 'valid', ms: 0.25, what: 'Parses the body and validates it against the OpenAPI schema.' },
  cache: { name: 'Response cache', short: 'cache', ms: 0.05, what: 'Serves cached GET responses (~40% hit ratio here). What it may hold depends on the cache scope.' },
  router: { name: 'Router', short: 'router', ms: 0.02, what: 'Picks the upstream cluster and forwards. Terminal: filters after it never run.' },
};

export const CLASSES: { id: C; label: string; color: string; hint: string }[] = [
  { id: 'legit', label: 'legit users', color: 'rgb(var(--c-ok))', hint: 'valid token, allowed, within quota' },
  { id: 'heavy', label: 'quota abusers', color: 'rgb(var(--c-warn))', hint: 'valid token, 5× over their plan' },
  { id: 'forbidden', label: 'unauthorized', color: 'rgb(var(--c-accent))', hint: 'valid token, wrong scope/tenant (should get 403)' },
  { id: 'badtoken', label: 'bad tokens', color: 'rgb(var(--c-violet))', hint: 'credential stuffing / forged JWTs' },
  { id: 'flood', label: 'IP flood', color: 'rgb(var(--c-bad))', hint: 'unauthenticated L7 flood from a few IPs' },
  { id: 'preflight', label: 'CORS preflight', color: 'rgb(var(--c-info))', hint: 'browser OPTIONS, no Authorization header' },
];

export const REFERENCE: F[] = ['cors', 'ip-limit', 'authn', 'user-limit', 'authz', 'validate', 'cache', 'router'];
export const ABUSE: C[] = ['heavy', 'forbidden', 'badtoken', 'flood'];
export const DEFAULT_RATES: Record<C, number> = { legit: 2000, heavy: 300, forbidden: 200, badtoken: 500, flood: 20000, preflight: 400 };
const CACHE_HIT = 0.4;

export type Outcome = 'served' | 'cached' | 'answered' | 'rejected' | 'leak' | 'dropped';
export interface Step {
  rej: number;
  outcome?: Outcome;
}
/** What the request has proven so far on its way through the chain. */
export interface Proven {
  identity: boolean;
  authorized: boolean;
}

/** What filter `f` does to a request of class `c`, given what has been verified so far. */
export function act(f: F, c: C, p: Proven, scope: CacheScope): Step {
  switch (f) {
    case 'cors':
      return c === 'preflight' ? { rej: 1, outcome: 'answered' } : { rej: 0 };
    case 'ip-limit':
      return c === 'flood' ? { rej: 0.9, outcome: 'rejected' } : { rej: 0 };
    case 'authn':
      return c === 'badtoken' || c === 'flood' || c === 'preflight' ? { rej: 1, outcome: 'rejected' } : { rej: 0 };
    case 'user-limit':
      return p.identity && c === 'heavy' ? { rej: 0.8, outcome: 'rejected' } : { rej: 0 };
    case 'authz':
      if (!p.identity) return { rej: 1, outcome: 'rejected' };
      return c === 'forbidden' ? { rej: 1, outcome: 'rejected' } : { rej: 0 };
    case 'validate':
      return c === 'flood' ? { rej: 0.6, outcome: 'rejected' } : { rej: 0 };
    case 'cache': {
      if (c === 'preflight') return { rej: 0 };
      if (scope === 'public') {
        // only public resources are cached, so a request for a protected one always misses
        return c === 'forbidden' ? { rej: 0 } : { rej: CACHE_HIT, outcome: 'cached' };
      }
      // shared cache of protected responses: a hit is safe only if this caller is actually allowed to see it
      const allowed = c === 'legit' || c === 'heavy' || p.authorized;
      return { rej: CACHE_HIT, outcome: allowed ? 'cached' : 'leak' };
    }
    case 'router':
      return { rej: 1, outcome: 'served' };
  }
}

export function advance(f: F, p: Proven): Proven {
  if (f === 'authn') return { ...p, identity: true };
  if (f === 'authz' && p.identity) return { ...p, authorized: true };
  return p;
}

export interface Eval {
  cpuMs: number;
  redisOps: number;
  legitOk: number;
  legitLatency: number;
  backend: number;
  backendAbuse: number;
  leaked: number;
  leakedBy: Partial<Record<C, number>>;
  rejectedAt: Partial<Record<F, number>>;
  issues: { tone: 'bad' | 'warn'; text: string }[];
  good: string[];
}

export function evaluate(chain: F[], rates: Record<C, number>, scope: CacheScope = 'shared'): Eval {
  const r: Eval = { cpuMs: 0, redisOps: 0, legitOk: 0, legitLatency: 0, backend: 0, backendAbuse: 0, leaked: 0, leakedBy: {}, rejectedAt: {}, issues: [], good: [] };
  const routerAt = chain.indexOf('router');
  const live = routerAt >= 0 ? chain.slice(0, routerAt + 1) : chain;
  let legitServed = 0;
  let preflightOk = 0;
  for (const cls of CLASSES) {
    let m = rates[cls.id] ?? 0;
    let p: Proven = { identity: false, authorized: false };
    let lat = 0;
    for (const f of live) {
      if (m <= 0) break;
      r.cpuMs += m * FILTERS[f].ms;
      if (f === 'user-limit') r.redisOps += m;
      if (cls.id === 'legit') lat += FILTERS[f].ms;
      const s = act(f, cls.id, p, scope);
      const out = m * s.rej;
      if (out > 0) {
        if (s.outcome === 'rejected') r.rejectedAt[f] = (r.rejectedAt[f] ?? 0) + out;
        if (s.outcome === 'served') {
          r.backend += out;
          if (ABUSE.includes(cls.id)) r.backendAbuse += out;
          if (cls.id === 'legit') legitServed += out;
        }
        if (s.outcome === 'cached' && cls.id === 'legit') legitServed += out;
        if (s.outcome === 'leak') {
          r.leaked += out;
          r.leakedBy[cls.id] = (r.leakedBy[cls.id] ?? 0) + out;
        }
        if (s.outcome === 'answered' && cls.id === 'preflight') preflightOk += out;
      }
      m -= out;
      p = advance(f, p);
    }
    if (cls.id === 'legit') r.legitLatency = lat;
  }
  const legitTotal = rates.legit + rates.preflight;
  r.legitOk = legitTotal ? (legitServed + preflightOk) / legitTotal : 1;

  const pos = (f: F) => chain.indexOf(f);
  const before = (a: F, b: F) => pos(a) >= 0 && pos(b) >= 0 && pos(a) < pos(b);
  const has = (f: F) => pos(f) >= 0 && (routerAt < 0 || pos(f) < routerAt);
  if (routerAt < 0) r.issues.push({ tone: 'bad', text: 'No router: nothing is forwarded. Every request ends in a 404 from the gateway.' });
  const dead = routerAt >= 0 ? chain.slice(routerAt + 1) : [];
  if (dead.length) r.issues.push({ tone: 'bad', text: `${dead.map((f) => FILTERS[f].name).join(', ')} sit after the router, so they never run. In Envoy the router filter is terminal and must be last.` });
  if (!has('authn')) r.issues.push({ tone: 'bad', text: 'No authentication before the router: forged and missing tokens reach your services.' });
  if (has('authn') && has('cors') && before('authn', 'cors')) r.issues.push({ tone: 'bad', text: 'CORS after AuthN: browser preflights carry no Authorization header, get 401, and the web app breaks. Answer OPTIONS first.' });
  if (has('authn') && !has('cors') && rates.preflight > 0) r.issues.push({ tone: 'warn', text: 'No CORS filter: preflights fall into AuthN and get 401. Browser clients cannot call this API.' });
  if (has('user-limit') && (!has('authn') || before('user-limit', 'authn')))
    r.issues.push({ tone: 'bad', text: 'User quota runs before identity is verified, so it can only key on a claimed, unverified user id. Abusers rotate it and bypass the quota, and every junk request still costs a Redis call. (A coarse IP limit before AuthN is fine because it needs no identity.)' });
  if (has('authz') && (!has('authn') || before('authz', 'authn'))) r.issues.push({ tone: 'bad', text: 'AuthZ before AuthN: there is no verified identity yet, so the policy sees anonymous and denies everyone (403).' });
  if (!has('authz') && rates.forbidden > 0)
    r.issues.push({ tone: 'warn', text: 'No AuthZ at the gateway: valid tokens with the wrong scope or tenant reach your services. Every service must then enforce authorization itself, and one that forgets is an IDOR.' });

  if (has('cache')) {
    if (scope === 'shared') {
      if (!has('authn') || before('cache', 'authn'))
        r.issues.push({ tone: 'bad', text: 'Protected-response cache before AuthN: cached private responses go to callers with no valid token. This is a data leak. Look up protected responses only after AuthN and AuthZ, or cache only public routes here.' });
      else if (!has('authz') || before('cache', 'authz'))
        r.issues.push({ tone: 'bad', text: 'Protected-response cache before AuthZ: a caller with a valid token but the wrong scope or tenant gets a cached response the backend would have refused with 403. This is an authorization bypass, and AuthN alone does not prevent it. Run AuthZ before any cache lookup that can return protected data (per-user keys narrow this but still serve revoked access until TTL).' });
    } else if (!has('authn') || before('cache', 'authn') || !has('authz') || before('cache', 'authz')) {
      r.good.push('Public-only cache ahead of auth is a legitimate choice, like a CDN: hits never contain user-specific data, and cheap hits absorb load before the expensive filters run. Keep user-specific responses marked `private`/`no-store` so they never enter this cache.');
    }
  }
  if (has('authn') && has('ip-limit') && before('authn', 'ip-limit'))
    r.issues.push({ tone: 'warn', text: 'IP limit after AuthN: the flood is signature-verified before it is dropped, so you burn CPU on RSA verifies for junk. Put cheap rejections first.' });
  if (!has('ip-limit') && rates.flood > 0) r.issues.push({ tone: 'warn', text: 'No coarse IP limit: the L7 flood reaches AuthN (and possibly the quota store) at full rate.' });
  if (has('validate') && has('user-limit') && before('validate', 'user-limit')) r.issues.push({ tone: 'warn', text: 'Body validation before the quota check: you parse bodies for requests you will reject with 429 anyway.' });
  if (!has('user-limit') && rates.heavy > 0) r.issues.push({ tone: 'warn', text: 'No per-user quota: abusers with valid tokens consume backend capacity unchecked.' });
  if (has('cache') && has('validate') && before('cache', 'validate') && has('authz') && before('authz', 'cache')) r.good.push('Cache before validation is fine for idempotent GETs, since hits skip body parsing.');
  if (chain.join() === REFERENCE.join()) r.good.push('This is the reference order: cheapest rejections first, identity before anything keyed on identity, authorization before anything that can return protected data, terminal router last.');
  return r;
}
