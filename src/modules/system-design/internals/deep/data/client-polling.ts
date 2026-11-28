import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'client-polling',

  problem: {
    why: 'Clients need to learn about changes such as new messages, job status or notification counts. The simplest approach is a timer: `GET /updates` every N seconds. It works with any HTTP stack, CDN, proxy and firewall, and needs no connection state on the server. It turns into an anti-pattern at scale and at short intervals. Load grows with clients ÷ interval whether or not anything changed, most responses are empty, and latency is still half the interval on average.',
    withoutIt: [
      'Clients have no way to learn about server-side changes without the user refreshing.',
      'Teams build WebSocket infrastructure for data that changes once an hour.',
      'Corporate proxies and old clients that break long-lived connections get no updates at all.',
      'But with naive short polling, 1M clients at 1 s = 1M req/s of mostly "nothing new".',
    ],
    position: 'Between clients and an API endpoint (often backed by the primary DB). Each poll runs the full request path (TLS, LB, auth, query) to discover that nothing changed.',
    diagram: {
      type: 'flow',
      title: 'Naive short polling',
      nodes: [
        { label: 'Client timer', sub: 'every 2 s', tone: 'warn' },
        { label: 'LB + TLS', sub: 'full request path' },
        { label: 'API + auth', sub: 'session lookup' },
        { label: 'DB query', sub: 'anything new?', tone: 'bad' },
        { label: '200 []', sub: '~99% empty', tone: 'bad' },
      ],
      caption: 'Cost is proportional to clients × frequency, not to the rate of actual changes.',
    },
  },

  architecture: {
    overview: 'A polling system has three knobs. The first is the interval, which sets load and latency. The second is the cost per poll: a full DB query, a cache lookup, or a 304 from a CDN. The third is synchronisation: whether clients spread out evenly or fire together. The mature version is "conditional, cached, adaptive polling". Clients send a cursor or ETag, the server answers 304 cheaply from cache, the interval stretches when idle and follows a server hint, and timers are jittered. Push channels (long-poll, SSE, WebSocket, mobile push) replace polling when changes are frequent or latency matters.',
    diagram: {
      type: 'layers',
      title: 'Polling, from naive to mature',
      layers: [
        { name: 'Client', items: ['Jittered timer', 'Adaptive interval', 'ETag / cursor', 'Pause when hidden'], tone: 'accent' },
        { name: 'Edge', items: ['CDN max-age=5', 'Conditional GET', '304 Not Modified', 'Rate limit + Retry-After'], tone: 'ok' },
        { name: 'API', items: ['Version check in cache', 'Poll-interval hint', 'Cheap auth'], tone: 'info' },
        { name: 'Data', items: ['Change counter / version', 'DB only on change'], tone: 'neutral' },
      ],
      caption: 'Each layer removes work from the one below; the DB should see changes, not polls.',
    },
    blocks: [
      { name: 'Interval', what: 'Load = clients ÷ interval; average staleness ≈ interval/2, worst case ≈ interval. Halving latency doubles load — a linear trade with no free lunch.' },
      { name: 'Conditional requests', what: 'Client sends `If-None-Match: <etag>` or `?since=<cursor>`. If nothing changed, the server returns `304 Not Modified` with no body, ideally from a cache without touching the DB.' },
      { name: 'Server-driven interval', what: 'Responses include a hint (`X-Poll-Interval`, `Retry-After`, or a JSON field) so the server can slow clients down under load or when idle without shipping a client release.' },
      { name: 'Jitter and adaptivity', what: 'Random offset per client and exponential stretch when nothing changes (2 s → 4 s → … → 60 s), reset on activity or focus. Prevents synchronised herds and cuts idle load.' },
      { name: 'Edge caching', what: 'For data shared by many clients (scores, status pages, prices), a CDN with `max-age` of a few seconds collapses millions of polls into one origin request per POP per TTL.' },
      { name: 'Long polling', what: 'The server holds the request open until data arrives or a timeout (20–60 s) passes. Latency is near-push, the request count tracks change rate, and it is still plain HTTP.' },
    ],
    real: [
      { name: 'GitHub REST API', how: 'Event endpoints return an `ETag` and `X-Poll-Interval`; conditional requests answered with 304 do not count against the rate limit, rewarding well-behaved pollers.' },
      { name: 'Amazon SQS', how: 'Short polling samples a subset of servers and may return empty even when messages exist; long polling (`WaitTimeSeconds` up to 20 s) queries all and cuts empty receives and cost, since SQS bills per request.' },
      { name: 'Dropbox API', how: '`list_folder/longpoll` blocks for 30–480 s and returns `changes: true` with a backoff hint; clients then fetch with a cursor. Classic long-poll + cursor design.' },
      { name: 'Telegram Bot API / Kafka', how: 'Telegram’s `getUpdates` takes a `timeout` for long polling. Kafka consumers are pull-based but block on the broker with `fetch.max.wait.ms`, so a pull model does not mean busy polling.' },
    ],
  },

  lifecycle: {
    summary: 'One empty 2 s poll from a logged-in web client for "new notifications", without caching. Multiply by clients ÷ 2 s.',
    stages: [
      { stage: 'Timer fires', what: 'Browser `setInterval` fires (throttled to ≥1 min in many background tabs).', cost: 'Client CPU, radio wake on mobile', ms: 0 },
      { stage: 'Network + TLS', what: 'Reused keep-alive connection; headers + cookies ~0.5–1 KB up.', cost: 'Bandwidth, LB connection', ms: 20 },
      { stage: 'LB + routing', what: 'L7 LB terminates TLS, routes to an API pod.', cost: 'LB LCU / request charge', ms: 1 },
      { stage: 'Auth', what: 'Validate session/JWT; maybe a Redis or DB lookup.', cost: '~0.5 ms CPU + lookup', ms: 2 },
      { stage: 'Query', what: '`SELECT count(*) FROM notifications WHERE user_id=? AND unread`.', cost: 'DB CPU + buffer pool', ms: 3 },
      { stage: 'Empty response', what: '200 with `{"count":0}` and full headers back.', cost: '~0.5 KB down', ms: 20 },
      { stage: 'Wait', what: 'Next poll in 2 s; a change that arrives just after this poll waits up to 2 s.', cost: 'Staleness avg 1 s', ms: 2000 },
    ],
  },

  deepDives: [
    {
      title: 'Polling math: load, emptiness and latency',
      hook: 'You pay for every client every interval, whether or not anything happened.',
      body: [
        'Request rate = active clients ÷ interval. Useful fraction = change rate per client × interval (capped at 1). A user who gets 10 notifications a day and polls every 5 s makes 17,280 requests a day for 10 useful answers, so 99.94% of polls are empty. Average staleness is interval/2.',
        'Bandwidth adds up too. With ~0.5–1 KB of request headers (cookies, auth, user agent) and a small response, 1M req/s means ~1 GB/s of mostly headers. HTTP/2 header compression helps on a reused connection, but CPU for TLS, routing, auth and logging is still paid per request.',
      ],
      table: {
        caption: 'Load at different scales (no caching)',
        columns: ['Clients', 'Interval', 'Requests/s', 'Avg staleness'],
        rows: [
          ['100k', '5 s', '20k', '2.5 s'],
          ['1M', '1 s', '1M', '0.5 s'],
          ['1M', '30 s', '~33k', '15 s'],
          ['10M', '1 s', '10M', '0.5 s'],
          ['10M (WebSocket heartbeat)', '30 s', '~330k pings', '~0 (push)'],
        ],
      },
      diagram: {
        type: 'compare',
        title: 'Same freshness, different cost',
        columns: [
          { name: 'Short poll 1 s', points: ['1 req/s per client', '~0.5 s staleness', 'Stateless servers'], tone: 'bad' },
          { name: 'Push (SSE/WS)', points: ['1 conn per client', '~ms staleness', 'Stateful gateway'], tone: 'ok' },
        ],
      },
      insight: 'Frame it as "cost scales with clients × frequency, value scales with change rate". When change rate is far lower than poll rate, push or long-poll wins; when they are close, polling is fine.',
    },
    {
      title: 'Conditional and cached polling',
      hook: 'A 304 from a CDN is about a thousand times cheaper than a DB query.',
      body: [
        'Make the no-change answer nearly free. Keep a per-resource version (a counter in Redis or a row `updated_at`) and return it as an ETag. The client sends `If-None-Match`; the API compares against the cached version and returns `304` without querying the DB. For cursor-based feeds, `?since=<cursor>` returns only new items and an empty body otherwise.',
        'For data shared by many users (live scores, status, prices), put the endpoint behind a CDN with `Cache-Control: max-age=2`. With 1M clients polling every 2 s across ~200 POPs, the origin sees roughly 200 POPs ÷ 2 s ≈ 100 req/s regardless of client count. Request collapsing on the CDN prevents a herd on expiry.',
      ],
      code: {
        lang: 'http',
        caption: 'Conditional poll round trip',
        code: `GET /v1/notifications/summary HTTP/2
If-None-Match: "v=1842"

HTTP/2 304 Not Modified
ETag: "v=1842"
X-Poll-Interval: 30
Cache-Control: private, no-cache

GET /v1/scores/match/77 HTTP/2

HTTP/2 200 OK
Cache-Control: public, max-age=2, stale-while-revalidate=5
ETag: "s=3-1"`,
      },
      insight: 'Private per-user data cannot be shared in a CDN, but it can still be answered from a version check in Redis. Design the "has anything changed?" check to be O(1).',
    },
    {
      title: 'Long polling: HTTP with push-like latency',
      hook: 'Hold the request open until there is something to say.',
      body: [
        'The client sends `GET /updates?cursor=c1`; the server parks the request (an async handler, not a thread) until a change arrives or 25–30 s pass, then responds. The client immediately re-polls with the new cursor. Latency is close to push, and requests per client ≈ changes + one per timeout.',
        'Costs: an open connection per client (as with WebSockets, but recycled every timeout), the need for a notification mechanism behind the API (Redis pub/sub, Postgres `LISTEN/NOTIFY`, an in-memory waiter map), and care with proxy and LB idle timeouts — keep the hold below them (e.g. 25 s under a 60 s ALB idle timeout). Messages sent between one response and the next poll must not be lost, which the cursor handles.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Long-poll with cursor',
        actors: ['Client', 'API', 'Pub/sub', 'Writer'],
        messages: [
          { from: 'Client', to: 'API', label: 'GET /updates?cursor=c1' },
          { from: 'API', to: 'Pub/sub', label: 'subscribe user:42' },
          { from: 'Writer', to: 'Pub/sub', label: 'publish new message', tone: 'accent' },
          { from: 'Pub/sub', to: 'API', label: 'wake waiter', tone: 'ok' },
          { from: 'API', to: 'Client', label: '200 items, cursor=c2', dashed: true, tone: 'ok' },
          { from: 'Client', to: 'API', label: 'GET ?cursor=c2 (again)' },
          { from: 'API', to: 'Client', label: '204 after 25 s', dashed: true },
        ],
        caption: 'The cursor guarantees nothing is missed between polls.',
      },
      insight: 'Long polling is the best fallback when WebSockets are blocked and is often enough on its own for low-to-medium message rates.',
    },
    {
      title: 'Herds, jitter and adaptive intervals',
      hook: 'A million clients with the same timer behave like one giant client.',
      body: [
        'Clients synchronise more easily than you would expect. App launches at the top of the hour, a push notification that opens the app, a deploy that resets every web session, or a recovery after an outage where every client retries at once. Fixed intervals keep them in lockstep, so load arrives as spikes of N requests rather than N ÷ interval per second.',
        'Use a random initial offset and ±20–50% jitter on every interval. Stretch the interval exponentially while nothing changes and reset it on change, user focus or interaction. Pause entirely in background tabs (`visibilitychange`) and honour `Retry-After` and server hints. On errors, back off exponentially with full jitter rather than retrying at the normal interval.',
      ],
      code: {
        lang: 'ts',
        caption: 'Adaptive, jittered poller',
        code: `let interval = 2000;
const MIN = 2000, MAX = 60000;

async function tick(etag?: string) {
  if (document.hidden) return schedule(MAX, etag);
  try {
    const res = await fetch('/v1/summary', { headers: etag ? { 'If-None-Match': etag } : {} });
    const hint = Number(res.headers.get('X-Poll-Interval')) * 1000;
    if (res.status === 200) { render(await res.json()); interval = MIN; }
    else interval = Math.min(interval * 2, MAX);
    schedule(Math.max(interval, hint || 0), res.headers.get('ETag') ?? etag);
  } catch {
    interval = Math.min(interval * 2, MAX);
    schedule(interval, etag);
  }
}

function schedule(ms: number, etag?: string) {
  const jittered = ms * (0.5 + Math.random());
  setTimeout(() => tick(etag), jittered);
}`,
      },
      insight: 'Server-side hints are the emergency brake: if you can raise every client’s interval from 2 s to 60 s with a header, an overload becomes a config change instead of an outage.',
    },
    {
      title: 'Choosing between poll, long-poll, SSE, WebSocket and push',
      hook: 'Match the channel to change frequency, direction and client environment.',
      body: [
        'Changes rare and latency tolerant (minutes): conditional polling with a long interval. Server→client stream with moderate rate (feeds, notifications, progress): SSE over HTTP/2, with automatic reconnect and `Last-Event-ID`. Bidirectional and low-latency (chat, collaboration, games): WebSocket. Mobile apps in the background: platform push (APNs/FCM), because the OS will not keep your sockets alive. Server-to-server: webhooks instead of partners polling your API.',
        'The push options move the cost from requests to connections. A connection costs tens of KB of memory, heartbeats and stateful gateways that complicate deploys. For a few hundred thousand clients with rare changes, well-cached polling may well be cheaper to run than a WebSocket fleet.',
      ],
      diagram: {
        type: 'flow',
        title: 'Decision path',
        nodes: [
          { label: 'Change rate?', sub: 'per client per minute' },
          { label: 'Rare → poll', sub: 'conditional, 30–300 s', tone: 'ok' },
          { label: 'Moderate → SSE', sub: 'or long-poll', tone: 'info' },
          { label: 'Bidirectional → WS', sub: 'chat, collab', tone: 'accent' },
          { label: 'Backgrounded → push', sub: 'APNs / FCM', tone: 'violet' },
        ],
      },
      insight: 'Hybrid is normal: WebSocket for foreground live data, push notifications to wake the app, and polling as the fallback when connections fail.',
    },
    {
      title: 'When polling IS the right answer',
      hook: 'Polling is boring, robust and cache-friendly — sometimes that wins.',
      body: [
        'Polling is right when updates are infrequent relative to the interval you can tolerate, when data is shared and cacheable at the edge, when clients sit behind restrictive proxies, when servers must stay stateless and simple to deploy, and for batch or background sync where minutes of staleness are fine. Job-status endpoints ("is my export ready?") with a 5–10 s interval for a few minutes are a classic good use.',
        'It is also self-limiting in a useful way: the server controls cost through intervals and caching, failures are per request, and there are no reconnect storms after deploys. Many successful APIs (GitHub, Dropbox, SQS) offer polling, but they shape it with ETags, cursors, interval hints and long-poll variants.',
      ],
      insight: 'The anti-pattern is not polling itself; it is unconditional, uncached, unjittered short polling of per-user data that rarely changes.',
    },
  ],

  scaling: {
    body: [
      'Polling scales horizontally trivially: stateless servers, any load balancer and CDN-cacheable responses. The problem is cost, not mechanism. Total load grows linearly with clients and inversely with interval, and the DB is the first victim if every poll queries it.',
      'Scaling levers in order: lengthen and adapt intervals, make no-change answers O(1) (ETag/version in cache), cache shared data at the edge, convert to long-poll, then move high-frequency users to push channels. Multi-region polling is easy because each region can answer from local caches, with async replication of versions.',
    ],
    bullets: [
      'Load = clients ÷ interval; staleness ≈ interval/2.',
      'Version/ETag check in Redis keeps the DB out of the empty-poll path.',
      'CDN max-age turns millions of shared polls into ~POPs ÷ TTL origin requests.',
      'Server hints (`X-Poll-Interval`, `Retry-After`) act as a global throttle.',
      'Jitter prevents synchronised spikes after deploys, outages and app launches.',
      'Long-poll keeps HTTP semantics with request rate ∝ change rate.',
    ],
  },

  failures: [
    {
      name: 'Empty-poll DB load',
      symptom: 'The primary DB burns CPU on millions of identical "anything new?" queries returning nothing.',
      detect: 'Top-queries report dominated by poll queries; high QPS with tiny result sets.',
      mitigate: 'Version check in cache, ETag/304, longer adaptive intervals, or move to push.',
    },
    {
      name: 'Synchronised herd',
      symptom: 'Load spikes at fixed intervals or right after an outage/deploy; servers fall over during recovery.',
      detect: 'Request-rate histogram at sub-second resolution shows periodic spikes.',
      mitigate: 'Random offset + jitter, exponential backoff on errors, `Retry-After` on 429/503.',
    },
    {
      name: 'Mobile battery and data drain',
      symptom: 'App flagged for battery use; complaints about background data.',
      detect: 'OS battery attribution, client telemetry of poll counts while backgrounded.',
      mitigate: 'Stop polling in background; use platform push to wake; batch requests.',
    },
    {
      name: 'Stale UI and missed updates',
      symptom: 'Users see changes late or not at all; events lost between polls.',
      detect: 'End-to-end latency probes from write to client render.',
      mitigate: 'Cursor-based polling (never "latest only"), shorter interval for active views, or push.',
    },
    {
      name: 'Rate-limit lockout',
      symptom: 'Third-party API starts returning 429/403; integration stops syncing.',
      detect: 'Rate-limit headers trending to zero; 429 count.',
      mitigate: 'Conditional requests (304s often free), honour poll hints, use webhooks where offered.',
    },
  ],

  warStories: [
    {
      title: 'The notification badge that ate the database',
      source: 'Composite of common incidents',
      what: 'A web app polled `/notifications/count` every 2 s from every open tab. With 400k concurrent tabs this was 200k req/s of `COUNT(*)` queries, nearly all returning the same number. The primary hit CPU saturation during a marketing peak. Adding a per-user version counter in Redis with ETag/304 and a 30 s adaptive interval cut DB load from that endpoint by over 99%.',
      lesson: 'Make the no-change path O(1) and off the database before reaching for a new transport.',
    },
    {
      title: 'Recovery herd after an outage',
      source: 'Composite of common incidents',
      what: 'After a 10-minute API outage, millions of mobile clients that had been retrying at their fixed 5 s interval hit the recovering service at once, plus queued user actions. The service fell over again twice before the team shipped a server hint raising the interval and enabled 503 + `Retry-After` shedding.',
      lesson: 'Build jitter, exponential backoff and a server-controlled interval into clients before you need them; you cannot hot-fix installed apps.',
    },
    {
      title: 'GitHub’s polling contract',
      source: 'GitHub REST API documentation (events, conditional requests)',
      what: 'GitHub exposes event feeds that integrators poll. Rather than forbid polling, the API returns ETags and an `X-Poll-Interval` header, and 304 responses to conditional requests do not count against the rate limit, so well-behaved clients are cheap and the server can slow everyone down by changing a header.',
      lesson: 'If you must support polling, design the contract — conditional requests, interval hints, incentives — instead of hoping clients behave.',
    },
  ],

  numbers: [
    { label: 'Request rate', value: 'clients ÷ interval', note: '1M @ 1 s = 1M req/s' },
    { label: '1M clients @ 30 s', value: '~33k req/s', note: 'staleness ~15 s avg' },
    { label: 'Average staleness', value: 'interval / 2', note: 'worst case ≈ interval' },
    { label: 'Request headers', value: '~0.5–1 KB', note: '1M req/s ≈ 0.5–1 GB/s up' },
    { label: 'SQS long-poll max wait', value: '20 s', note: 'WaitTimeSeconds' },
    { label: 'Dropbox longpoll timeout', value: '30–480 s' },
    { label: 'Long-poll hold', value: '~25 s', note: 'stay below 60 s LB idle timeout' },
    { label: '10M WS heartbeats @ 30 s', value: '~330k/s', note: 'vs 10M req/s polling @ 1 s' },
  ],

  capacity: {
    question: 'A sports app has 5M concurrent users watching live scores that change every ~20 s per match. Product wants ≤2 s staleness. Polling or push?',
    steps: [
      'Naive per-user polling at 1 s (staleness ~0.5 s): 5M req/s to origin — unacceptable.',
      'Scores are shared, not per-user: serve `/match/{id}` from a CDN with `max-age=1`. Origin load ≈ POPs × matches ÷ TTL, e.g. 200 × 50 ÷ 1 s = 10k req/s, mostly from cache.',
      'Edge still serves 5M req/s; at ~1 KB each that is ~5 GB/s of CDN egress — expensive but within CDN capacity.',
      'Alternative: SSE/WebSocket fan-out of ~3 updates/min per match: 5M connections, ~250k messages/s, plus a gateway fleet of ~50–100 nodes.',
      'Compare cost: CDN polling is operationally simple; push saves egress and gives sub-second updates.',
    ],
    answer: 'Shared, cacheable data makes CDN-cached polling viable at this scale; choose push if sub-second updates or egress costs dominate. Per-user data would force push or long-poll.',
  },

  comparison: {
    caption: 'Update delivery techniques',
    columns: ['Technique', 'Latency', 'Server cost driver', 'Infra friendliness', 'Fits'],
    rows: [
      ['Short polling', 'interval / 2', 'clients ÷ interval', 'Excellent', 'Rare changes, job status'],
      ['Conditional + CDN polling', 'interval / 2 + TTL', 'Origin: POPs ÷ TTL', 'Excellent', 'Shared public data'],
      ['Long polling', '~ms–s', 'Open requests + changes', 'Good (watch idle timeouts)', 'Fallback, moderate rates'],
      ['SSE', '~ms', 'Open connections', 'Good over HTTP/2', 'Server→client feeds'],
      ['WebSocket', '~ms', 'Connections + heartbeats', 'Needs Upgrade support', 'Chat, collab, games'],
      ['Push notif. / webhooks', 'seconds', 'Per event', 'Platform / partner side', 'Background mobile, server-to-server'],
    ],
  },

  whenNot: [
    'Per-user data polled every few seconds by millions of clients.',
    'Interactive features needing sub-second latency (chat, presence, collaboration).',
    'Mobile apps in the background — use platform push.',
    'Server-to-server integrations where the provider offers webhooks.',
    'Any poll that hits the primary database without a cheap "unchanged" path.',
  ],

  interview: [
    {
      q: 'Clients poll `/notifications` every 2 s and the DB is melting. What do you do?',
      a: 'Immediately: raise the interval via a server hint or config, add jitter, and make the no-change path cheap — a per-user version in Redis with ETag/304 so the DB is touched only on change. Then decide on the channel: if notifications are rare, adaptive conditional polling is enough; if users expect instant updates, move foreground clients to SSE or WebSocket and use push notifications in the background.',
      followUps: ['How do you change client intervals without a release?', 'How would you avoid missing notifications?'],
      seniorSignal: 'Separates the emergency brake from the long-term fix and quantifies the load.',
    },
    {
      q: 'Compute the load and latency of polling for 2M clients at 10 s.',
      a: '2M ÷ 10 s = 200k req/s; average staleness 5 s, worst case 10 s. With ~1 KB headers that is ~200 MB/s inbound. If changes average once per 10 minutes per client, ~98% of polls are empty.',
      followUps: ['What happens if all clients start at once?', 'What does long-polling change in this math?'],
      seniorSignal: 'Does the arithmetic quickly and relates poll rate to change rate.',
    },
    {
      q: 'Short polling vs long polling vs SSE vs WebSocket — how do you choose?',
      a: 'By change rate, direction, latency target and environment. Rare changes: conditional polling. Server-to-client streams: SSE (HTTP-friendly, auto-reconnect). Bidirectional low latency: WebSocket. Restrictive proxies or simple infra: long-poll. Backgrounded mobile: platform push. Push trades request cost for connection state and deploy complexity.',
      followUps: ['Why might SSE beat WebSocket for notifications?', 'What breaks long-polling behind load balancers?'],
      seniorSignal: 'Explains the cost model shift (requests → connections) rather than declaring WebSockets always better.',
    },
    {
      q: 'When is polling the best choice?',
      a: 'When changes are infrequent relative to acceptable staleness, when data is shared and CDN-cacheable, when servers must stay stateless, when clients are behind proxies, or for short-lived job status checks. With ETags, cursors, jitter and server hints, polling is robust and cheap, and it avoids reconnect storms.',
      followUps: ['How does GitHub make polling cheap?', 'How would you cache per-user poll responses?'],
      seniorSignal: 'Defends polling where appropriate and lists the techniques that make it safe.',
    },
    {
      q: 'How do you prevent a polling herd after an outage?',
      a: 'Clients use exponential backoff with full jitter on errors and a random offset for normal polls; the server sheds with 503 + `Retry-After` and can raise intervals globally via a header. Admission control and per-client rate limits protect recovery, and caches are warmed before reopening.',
      followUps: ['Why is full jitter better than fixed backoff?', 'How do you ship this to old app versions?'],
      seniorSignal: 'Recognises synchronisation as the real risk and puts control on the server side.',
    },
  ],

  takeaways: [
    'Polling load = clients ÷ interval; staleness ≈ interval/2 — a linear trade.',
    'Most polls are empty; make the unchanged path O(1) with ETags/versions and 304s.',
    'Cache shared data at the CDN; origin load becomes POPs ÷ TTL.',
    'Jitter, adaptive intervals and server hints prevent herds and act as a global throttle.',
    'Long-poll gives push-like latency over plain HTTP; use cursors so nothing is missed.',
    'Use SSE/WebSocket for frequent or interactive updates, platform push for background mobile.',
    'Polling is right for rare changes, job status, cacheable data and restrictive networks.',
  ],
};

export default deep;
