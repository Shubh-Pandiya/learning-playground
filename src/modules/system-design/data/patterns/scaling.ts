import type { Pattern } from '../../types';
import { E, N, R, W, X, req } from './dsl';

export const loadBalancing: Pattern = {
  id: 'load-balancing',
  num: 1,
  title: 'Load Balancing & Horizontal Scaling',
  group: 'Scaling',
  tagline: 'One server is a ceiling and a single point of failure. Many identical ones behind a balancer are neither.',
  minutes: 8,
  level: 'Beginner',
  signals: ['"millions of users"', '"handle traffic growth"', '"no downtime when a server dies"', 'stateless API tier'],
  learn: [
    'Why scaling out beats scaling up',
    'What a load balancer does (and health checks)',
    'N+1 capacity: survive losing a box',
    'Why the app tier must be stateless',
  ],
  realWorld: [
    { who: 'Netflix', how: 'Thousands of stateless service instances behind AWS ELB + their own Zuul/Envoy layer.' },
    { who: 'GitHub', how: 'HAProxy/GLB in front of stateless Rails app servers; sessions live in a shared store.' },
    { who: 'Kubernetes', how: 'A Service + Ingress is exactly this pattern: replicas behind a health-checked balancer.' },
  ],
  scenario: {
    id: 'lb-launch',
    title: 'Launch day for a link-in-bio app',
    context:
      'A creator tool is about to be featured on a big podcast. Expect 3,000 req/s at peak (90% reads). One app server tops out at ~2,000 req/s. The founders want no downtime if a server dies mid-launch.',
    workload: { qps: 3000, readRatio: 0.9 },
    requirements: [
      req.qps(3000, 'One app server handles ~2,000 req/s. You need more than one — and something to spread traffic.'),
      req.survives('app', 'Losing one app server causes no errors', 'Have enough spare capacity (N+1) and something that health-checks instances.'),
      req.p99(60),
    ],
    palette: ['client', 'lb', 'sticky-lb', 'app', 'big-server', 'db', 'cache', 'dns', 'nfs'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Browsers and phones generating ~3k req/s.'),
        N('lb', 'lb', X[1], 120, 'Spreads requests across app servers and stops sending to ones that fail health checks.'),
        N('app', 'app', X[2], 120, 'Three stateless servers: 2 carry the 3k req/s peak, the third is spare so one can die (N+1).', { count: 3 }),
        N('db', 'db', X[3], 120, 'Single source of truth for profiles and links. ~3.3k load units — fine for one primary.'),
      ],
      edges: [
        E('client', 'lb', 'All traffic enters through one stable address: the load balancer.'),
        E('lb', 'app', 'Round-robin / least-connections across healthy instances.'),
        E('app', 'db', 'Every app server talks to the same database, so any server can handle any request.'),
      ],
    },
    wrong: {
      'big-server': W.bigServer,
      'sticky-lb': W.sticky,
      nfs: W.nfs,
    },
  },
  extras: {
    nodes: [N('x-one', 'app', X[2], 120, 'The MVP: one server doing everything.', { label: 'Single server' }), N('x-big', 'big-server', X[2], 120, 'Scale up: a 4× bigger machine.')],
    edges: [E('client', 'x-one', undefined, 'lb'), E('x-one', 'db'), E('client', 'x-big', undefined, 'lb'), E('x-big', 'db')],
  },
  guided: [
    {
      title: 'One server, launch-day traffic',
      tag: 'problem',
      body: [
        'The MVP is a single app server in front of a database. It can handle about **2,000 req/s**.',
        'The podcast drives **3,000 req/s**. Watch what happens to the server — and to every user on it.',
      ],
      add: ['client', 'x-one', 'db'],
      predict: {
        question: 'At 3,000 req/s against a 2,000 req/s server, what do users see?',
        options: ['Everything is fine, just slower', 'About 1/3 of requests fail and the rest get very slow', 'Only writes fail'],
        answer: 1,
        explain: 'Past saturation, queues grow without bound: latency explodes and the overflow is dropped (timeouts / 503s). Everyone suffers, not just the extra third.',
      },
      keyIdea: 'Every component has a throughput ceiling. Utilisation past ~70% makes latency climb steeply (queueing theory); past 100% you shed requests.',
    },
    {
      title: 'The tempting fix: a bigger box',
      tag: 'tradeoff',
      body: [
        'Vertical scaling (4× CPU) makes the numbers work today. It is a valid first move for small systems.',
        'But it has a hard ceiling, costs super-linearly, and you still have **one** machine. Kill it and see.',
      ],
      add: ['x-big'],
      remove: ['x-one'],
      kill: ['x-big'],
      predict: {
        question: 'The big server crashes. What happens?',
        options: ['Requests slow down', 'Full outage', 'The database takes over'],
        answer: 1,
        explain: 'One machine = one failure domain. Scale-up never removes the single point of failure.',
      },
      goodToKnow: 'Stack Overflow famously ran on a handful of very large servers for years — scale-up is fine until availability or the ceiling bites.',
    },
    {
      title: 'Scale out behind a load balancer',
      tag: 'technique',
      body: [
        'Put **several identical, stateless app servers** behind a **load balancer**. The LB is the single address clients hit; it spreads requests and health-checks every instance.',
        'Three servers: two are enough for 3k req/s, the third is headroom.',
      ],
      add: ['lb', 'app'],
      remove: ['x-big'],
      keyIdea: 'Horizontal scaling turns capacity into a dial: need more? add instances. It only works if any server can handle any request — i.e. the tier is stateless.',
    },
    {
      title: 'Kill one app server',
      tag: 'failure',
      body: ['The load balancer health-checks every few seconds. When an instance stops answering it is pulled from rotation and the remaining two absorb its traffic.'],
      kill: ['app'],
      predict: {
        question: 'One of three app servers dies. What do users notice?',
        options: ['Full outage', 'About a third of requests fail', 'Nothing (slightly higher load on the others)'],
        answer: 2,
        explain: 'The LB routes around it, and N+1 sizing means the survivors have room. Without the spare instance this would overload the remaining ones.',
      },
      goodToKnow: 'This is why teams talk about "N+1" or "N+2": capacity planning assumes something is always broken or being deployed.',
    },
    {
      title: 'Stateless or bust',
      tag: 'tradeoff',
      body: [
        'If server A keeps your session in memory, the next request may land on server B and you are logged out. The quick hack is **sticky sessions** — but then losing A logs out all of A\'s users, and load can\'t rebalance.',
        'Instead keep session state in a shared store (Redis or the DB) or in a signed cookie/JWT.',
      ],
      keyIdea: 'Push state down (DB/cache) or out (client token). The compute tier should be cattle, not pets.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Client → **LB** → **N stateless servers** → shared data. Capacity scales linearly with N; failures are absorbed by spare instances.',
        'Next bottleneck: the database. Push the traffic slider to 1.3× and watch it turn red — that\'s what caching, replicas and sharding are for.',
      ],
    },
  ],
  quiz: [
    {
      id: 'lb-q1',
      q: 'Your API runs on 4 servers at 80% CPU each. You must survive one server failing. What is the minimum fleet size?',
      options: ['4', '5', '6', '8'],
      answer: 1,
      why: '4 × 80% = 3.2 servers of work. With one down you need ≥ 4 healthy at ≤ 80%… 3.2 / 4 = 80%, so 5 total gives N+1.',
    },
    {
      id: 'lb-q2',
      q: 'Why are sticky sessions considered an anti-pattern for scaling?',
      options: ['They are slower', 'They tie users to one instance, so failures log users out and load can\'t rebalance', 'They require HTTPS', 'Load balancers don\'t support them'],
      answer: 1,
      why: 'Sticky sessions make instances stateful. Keep state in a shared store so any instance can serve any request.',
    },
    {
      id: 'lb-q3',
      q: 'What does an L7 load balancer\'s health check protect you from?',
      options: ['DDoS attacks', 'Sending traffic to dead or unhealthy instances', 'Slow database queries', 'Data loss'],
      answer: 1,
      why: 'Health checks remove failing instances from rotation; they don\'t fix slow dependencies or attacks.',
    },
  ],
  challenge: {
    id: 'lb-resize',
    title: 'Image-resize API (no database)',
    context:
      'A CPU-bound service resizes images on the fly: 7,000 req/s, all stateless, no database. Each server handles ~2,000 req/s. The SLA says no single failure — anywhere — may take the API down.',
    workload: { qps: 7000, readRatio: 1 },
    requirements: [
      req.qps(7000),
      req.survives('app', 'Losing one server causes no errors', 'Size for N+1.'),
      req.noSpof('Is there anything left with a single instance? Even the load balancer counts.'),
    ],
    palette: ['client', 'lb', 'sticky-lb', 'app', 'big-server', 'db', 'cache', 'nfs', 'dns'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Callers of the resize API.'),
        N('lb', 'lb', X[1], 120, 'Two load balancers (active/passive or DNS round-robin) so the LB is not itself a SPOF.', { count: 2 }),
        N('app', 'app', X[2], 120, '5 stateless workers: 4 carry 7k req/s at ~90%, the 5th is spare.', { count: 5 }),
      ],
      edges: [E('client', 'lb'), E('lb', 'app')],
    },
    wrong: {
      'big-server': W.bigServer,
      'sticky-lb': W.sticky,
      nfs: W.nfs,
      db: { why: 'Nothing here needs to persist. A database would just add a hop and a single point of failure.' },
    },
  },
};

export const caching: Pattern = {
  id: 'caching',
  num: 2,
  title: 'Caching (Cache-Aside)',
  group: 'Scaling',
  tagline: 'Most reads ask for the same few things. Answer them from memory and the database barely notices.',
  minutes: 10,
  level: 'Beginner',
  signals: ['"read-heavy" (10:1 or more)', '"same items requested repeatedly"', '"low latency"', 'DB CPU is the bottleneck'],
  learn: ['How cache-aside works on read and write', 'Hit ratio and what it buys you', 'Invalidation & TTL staleness', 'Thundering herd when the cache dies'],
  realWorld: [
    { who: 'Facebook', how: 'Memcache in front of MySQL serves billions of reads/s; TAO caches the social graph.' },
    { who: 'Twitter', how: 'Timelines are precomputed and served out of Redis clusters.' },
    { who: 'Shopify', how: 'Caches rendered storefront fragments and product data in Memcached/Redis.' },
  ],
  scenario: {
    id: 'cache-catalog',
    title: 'Product catalog API',
    context:
      'An online store serves product pages: 12,000 req/s at peak, 95% reads. A tiny set of best-sellers gets most of the traffic (90% hit ratio is realistic). The SQL primary can do ~4,000 load units/s.',
    workload: { qps: 12000, readRatio: 0.95, cacheHit: 0.9 },
    requirements: [
      req.qps(12000, 'The DB is drowning in repeated reads. Answer them before they get there.'),
      req.p99(40, 'Serve the hot reads from memory.'),
      req.survives('app', 'Losing one app server causes no errors', 'Leave headroom in the app tier.'),
    ],
    palette: ['client', 'lb', 'app', 'big-server', 'db', 'cache', 'local-cache', 'replica', 'nosql', 'cdn'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Shoppers browsing products.'),
        N('lb', 'lb', X[1], 120, 'Spreads load across the app tier.'),
        N('app', 'app', X[2], 120, '8 instances for 12k req/s with one spare.', { count: 8 }),
        N('cache', 'cache', X[3], 40, 'Shared Redis: on a hit (~90%) the DB is never touched; on a miss the app reads the DB and fills the cache.'),
        N('db', 'db', X[3], 200, 'Now only sees cache misses + writes (~2.3k units instead of 12.6k).'),
      ],
      edges: [
        E('client', 'lb'),
        E('lb', 'app'),
        E('app', 'cache', 'Cache-aside: the app checks the cache first…'),
        E('app', 'db', '…and only goes to the DB on a miss (then SETs the cache). Writes go to the DB and DELETE the cache key.'),
      ],
    },
    wrong: {
      'local-cache': W.localCache,
      'big-server': W.bigServer,
    },
  },
  extras: { nodes: [], edges: [] },
  guided: [
    {
      title: 'The database is the bottleneck',
      tag: 'problem',
      body: [
        'The app tier scales horizontally, but every request still hits one SQL primary. 11,400 reads/s + writes ≈ **12.6k load units** against a 4k ceiling.',
        'Most of those reads are for the same few hundred products.',
      ],
      add: ['client', 'lb', 'app', 'db'],
      predict: {
        question: 'Adding more app servers would…',
        options: ['Fix it', 'Make it worse — more connections hammering the same DB', 'Do nothing to the DB load'],
        answer: 2,
        explain: 'App servers aren\'t the constraint. The DB load is set by the request rate, not the number of callers (more callers mostly add connections).',
      },
    },
    {
      title: 'Cache-aside',
      tag: 'technique',
      body: [
        '**Read:** `GET product:42` from Redis. Hit → return in ~1 ms. Miss → query the DB, then `SET product:42 … EX 300`.',
        '**Write:** update the DB, then `DEL product:42` so the next read refills it.',
        'With a 90% hit ratio the DB sees one read in ten.',
      ],
      add: ['cache'],
      keyIdea: 'Cache effectiveness = hit ratio. 90% hits means 10× fewer DB reads; 99% means 100×. Skewed (Zipfian) access is why caches work so well.',
      goodToKnow: 'Why DEL instead of SET on write? Two concurrent writers can SET in the wrong order and leave stale data forever; deleting lets the next read fetch the truth.',
    },
    {
      title: 'Staleness is the price',
      tag: 'tradeoff',
      body: [
        'Between a DB write and the cache delete, or if a delete is lost, readers see old data until the TTL expires.',
        'For a product description that\'s fine. For an account balance it is not — don\'t cache it, or use short TTLs and read-your-writes from the DB.',
      ],
      keyIdea: 'Cache what is read often, changes rarely, and tolerates a little staleness.',
    },
    {
      title: 'The cache node dies',
      tag: 'failure',
      body: ['Now every read misses and goes straight to the DB. This is the **thundering herd / cache stampede**.'],
      kill: ['cache'],
      predict: {
        question: 'The cache crashes during peak. What happens to the DB?',
        options: ['Nothing, the app handles it', 'It gets 10× the read load and falls over', 'Writes stop working only'],
        answer: 1,
        explain: 'The cache was absorbing 90% of reads. Without it the DB gets the full load — which is why it needed the cache in the first place.',
      },
      goodToKnow: 'Mitigations: a replicated cache cluster, request coalescing (only one miss per key fetches from the DB), stale-while-revalidate, and warming caches before cut-over.',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: [
        'Cache-aside puts a fast shared memory tier beside the DB. It\'s the single highest-leverage scaling move for read-heavy systems.',
        'Watch out for invalidation bugs, cold starts and stampedes. Never use per-server caches when you need consistency across servers.',
      ],
    },
  ],
  quiz: [
    {
      id: 'cache-q1',
      q: 'A cache has a 95% hit ratio and the DB handles 1,000 reads/s comfortably. Roughly how many reads/s can the system serve?',
      options: ['1,050', '5,000', '20,000', 'Unlimited'],
      answer: 2,
      why: 'Only 5% reach the DB: 1,000 / 0.05 = 20,000 reads/s (until the cache or app tier saturates).',
    },
    {
      id: 'cache-q2',
      q: 'In cache-aside, what should a write do to the cache?',
      options: ['Nothing', 'Update the DB, then delete the cache key', 'Update the cache, then the DB', 'Only update the cache'],
      answer: 1,
      why: 'Deleting avoids racing writers leaving stale values; the next reader refills from the source of truth.',
    },
    {
      id: 'cache-q3',
      q: 'Why is a per-server in-memory cache a poor fit for a 20-node app tier?',
      options: ['It\'s slower than Redis', '20 cold copies, low hit rate, and they disagree after writes', 'It can\'t store JSON', 'It uses disk'],
      answer: 1,
      why: 'Local caches fragment the working set and can\'t be invalidated consistently across nodes.',
    },
  ],
  challenge: {
    id: 'cache-leaderboard',
    title: 'Game profile & leaderboard service',
    context:
      'A mobile game shows player profiles and the top-100 leaderboard: 15,000 req/s, 97% reads, and 95% of reads hit a small hot set. Score updates are 3% of traffic.',
    workload: { qps: 15000, readRatio: 0.97, cacheHit: 0.95 },
    requirements: [req.qps(15000), req.p99(40), req.survives('app', 'Losing one app server causes no errors', 'N+1 in the app tier.')],
    palette: ['client', 'lb', 'app', 'big-server', 'db', 'cache', 'local-cache', 'replica', 'sticky-lb', 'multi-master'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Players.'),
        N('lb', 'lb', X[1], 120, 'Balances across the API tier.'),
        N('app', 'app', X[2], 120, '10 instances (15k req/s with headroom).', { count: 10 }),
        N('cache', 'cache', X[3], 40, 'Hot profiles and the leaderboard live in Redis (sorted sets are perfect for leaderboards).'),
        N('db', 'db', X[3], 200, 'Source of truth; sees misses + score writes.'),
      ],
      edges: [E('client', 'lb'), E('lb', 'app'), E('app', 'cache'), E('app', 'db')],
    },
    wrong: { 'local-cache': W.localCache, 'big-server': W.bigServer, 'sticky-lb': W.sticky, 'multi-master': W.multiMaster },
  },
};

export const cdn: Pattern = {
  id: 'cdn',
  num: 3,
  title: 'CDN & Edge Caching',
  group: 'Scaling',
  tagline: 'Serve the same bytes from a server 20 ms from the user instead of 200 ms — and never bother your origin.',
  minutes: 8,
  level: 'Beginner',
  signals: ['"global users"', '"static assets / images / video"', '"traffic spike on the same content"', 'egress cost'],
  learn: ['What a CDN caches and for how long', 'Origin offload and why it saves money', 'Cache keys, TTLs, purge', 'What not to put on a CDN'],
  realWorld: [
    { who: 'Netflix', how: 'Open Connect appliances inside ISPs serve ~all video bytes; the origin barely sees viewers.' },
    { who: 'The Guardian / NYT', how: 'Article HTML is cached at Fastly for seconds to minutes and purged on publish.' },
    { who: 'Shopify', how: 'Storefront assets and images served via Cloudflare with long, immutable cache headers.' },
  ],
  scenario: {
    id: 'cdn-news',
    title: 'Breaking-news article pages',
    context:
      'A news site\'s breaking story is being read worldwide: 30,000 req/s, 99% reads, and every reader gets the same article HTML. A CDN can serve ~95% of it from the edge. Writes are editors and comments.',
    workload: { qps: 30000, readRatio: 0.99, cdnHit: 0.95 },
    requirements: [
      req.qps(30000, 'The same page is requested 30k times a second. Stop sending identical requests to your servers.'),
      req.p99(40, 'Serve the page from close to the user.'),
      req.survives('app', 'Losing one origin server causes no errors', 'Keep the origin tier N+1.'),
    ],
    palette: ['client', 'cdn', 'dns', 'lb', 'app', 'big-server', 'db', 'cache', 'local-cache', 'client-polling'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Readers on every continent.'),
        N('cdn', 'cdn', X[1], 120, 'Edge PoPs cache the article for ~30 s. ~95% of requests never leave the edge.'),
        N('lb', 'lb', X[2], 120, 'Origin load balancer — now only sees misses and writes.'),
        N('app', 'app', X[3], 120, 'Origin renders the page; 3 instances is plenty after offload.', { count: 3 }),
        N('db', 'db', X[4], 120, 'Articles + comments.'),
      ],
      edges: [
        E('client', 'cdn', 'DNS points the domain at the CDN; the nearest PoP answers.'),
        E('cdn', 'lb', 'Misses (and uncacheable writes) go back to the origin.'),
        E('lb', 'app'),
        E('app', 'db'),
      ],
    },
    wrong: {
      'big-server': W.bigServer,
      'client-polling': { why: 'Auto-refreshing every second multiplies requests ~10× during exactly the moment you are busiest.', instead: 'Short CDN TTLs (or SSE for a live blog).' },
      'local-cache': W.localCache,
    },
  },
  extras: { nodes: [], edges: [E('client', 'lb', undefined, 'cdn')] },
  guided: [
    {
      title: '30,000 people want the same page',
      tag: 'problem',
      body: [
        'Every reader in Sydney, São Paulo and London crosses the planet to your origin, and the origin re-renders the **identical** page 30,000 times a second.',
        'Watch the app tier and DB turn red.',
      ],
      add: ['client', 'lb', 'app', 'db'],
      predict: {
        question: 'What is the cheapest way to handle 10× more readers of the same page?',
        options: ['10× the servers', 'Cache the response close to users', 'A bigger database'],
        answer: 1,
        explain: 'If every user gets the same bytes, compute them once and copy them to the edge.',
      },
    },
    {
      title: 'Put a CDN in front',
      tag: 'technique',
      body: [
        'A CDN is a global network of caching reverse proxies (PoPs). DNS sends each user to a nearby PoP. On a hit it answers in ~10–20 ms; on a miss it fetches from your origin once and caches it.',
        'The origin goes from 30k req/s to ~1.5k.',
      ],
      add: ['cdn'],
      keyIdea: 'CDNs cut latency (physics: fewer km) and origin load (offload ratio). Both scale with the cache hit ratio.',
      goodToKnow: '`Cache-Control: public, max-age=30, stale-while-revalidate=60` lets the edge serve slightly stale pages while it refreshes in the background.',
    },
    {
      title: 'Freshness vs offload',
      tag: 'tradeoff',
      body: [
        'Longer TTLs = higher hit ratio but staler pages. When an editor fixes a typo, **purge** the URL (all major CDNs expose a purge API) or use versioned URLs for assets (`app.3f9a.js`).',
        'Personalised or authenticated responses must not be cached publicly — vary the cache key or bypass the CDN.',
      ],
      keyIdea: 'Static & identical → CDN with long TTL. Shared but changing → short TTL + purge. Per-user → origin.',
    },
    {
      title: 'An origin server dies',
      tag: 'failure',
      kill: ['app'],
      body: ['The CDN shields you: most traffic never reaches the origin, and the LB routes the few misses to healthy servers.'],
      predict: {
        question: 'One of 3 origin servers dies. Impact?',
        options: ['Outage', 'None — the CDN and LB absorb it', 'Readers get errors 1/3 of the time'],
        answer: 1,
        explain: 'Edge hits are untouched and the LB health-checks the origin.',
      },
      goodToKnow: 'Many CDNs can also serve stale content when the origin is completely down ("stale-if-error").',
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: ['CDN = cache at the edge of the network. Use it for anything many users fetch identically: assets, images, video segments, public pages and even cacheable API responses.'],
      traffic: 1.5,
    },
  ],
  quiz: [
    {
      id: 'cdn-q1',
      q: 'A CDN has a 98% hit ratio for a 50k req/s site. How many req/s reach the origin?',
      options: ['50,000', '10,000', '1,000', '98'],
      answer: 2,
      why: '2% of 50,000 = 1,000 req/s.',
    },
    {
      id: 'cdn-q2',
      q: 'Which response should NOT be cached publicly on a CDN?',
      options: ['A product image', 'The JS bundle', 'GET /me/orders with the user\'s order history', 'A public blog post'],
      answer: 2,
      why: 'Per-user data must never be shared between users via a public cache key.',
    },
    {
      id: 'cdn-q3',
      q: 'How do you update a JS bundle that is cached at the edge for a year?',
      options: ['Wait a year', 'Change its URL (content hash in the filename)', 'Restart the CDN', 'Lower the DB TTL'],
      answer: 1,
      why: 'Immutable, versioned URLs: new content = new URL, so there is nothing to invalidate.',
    },
  ],
  challenge: {
    id: 'cdn-downloads',
    title: 'Game patch downloads',
    context:
      'A game studio ships a 2 GB patch. 60,000 download requests/s hit at release, all for the same files stored in object storage. Players worldwide expect fast starts.',
    workload: { qps: 60000, readRatio: 1, cdnHit: 0.95 },
    requirements: [
      req.p99(20, 'Object storage is ~40 ms away from most players. Bring the bytes closer.'),
      req.has('cdn', 'Players fetch from a nearby edge', 'Which component caches at the edge?'),
      req.none(['app', 'big-server'], "Don't proxy file bytes through app servers", 'Your servers add nothing here; let storage + edge do the work.'),
    ],
    palette: ['client', 'cdn', 'lb', 'app', 'big-server', 'object-store', 'nfs', 'blob-column', 'db', 'dns'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Players downloading the patch.'),
        N('cdn', 'cdn', X[1], 120, 'Edge caches the patch files; origin is hit once per PoP.'),
        N('object-store', 'object-store', X[2], 120, 'Durable origin for build artifacts.'),
      ],
      edges: [E('client', 'cdn'), E('cdn', 'object-store')],
    },
    wrong: {
      nfs: W.nfs,
      'blob-column': W.blobColumn,
      'big-server': W.bigServer,
      app: { why: 'Streaming gigabytes through app servers burns CPU and bandwidth to add zero value.', instead: 'CDN in front of object storage.' },
    },
  },
};

export const readReplicas: Pattern = {
  id: 'read-replicas',
  num: 4,
  title: 'Replication & Read Replicas',
  group: 'Data',
  tagline: 'Copy the database. Writes go to one primary, reads fan out to many copies — and you survive a dead disk.',
  minutes: 10,
  level: 'Beginner',
  signals: ['"read-heavy" with fresh-ish data', '"reporting queries slow down the app"', '"don\'t lose data if a disk dies"'],
  learn: ['Leader/follower replication', 'Scaling reads (not writes)', 'Replication lag & read-your-writes', 'Copies ≠ automatic failover'],
  realWorld: [
    { who: 'GitHub', how: 'MySQL primaries with many replicas; reads go to replicas, with lag-aware routing.' },
    { who: 'Instagram', how: 'Postgres primary per shard with streaming replicas for reads and failover.' },
    { who: 'AWS RDS / Aurora', how: 'Up to 15 read replicas sharing storage; promote one if the writer dies.' },
  ],
  scenario: {
    id: 'rep-profiles',
    title: 'Social profile service',
    context:
      'Profiles and follower lists: 10,000 req/s, 95% reads. Data changes often enough that a cache would be stale, but readers tolerate ~1 s of lag. The DBA also wants a second copy of the data in case a disk dies.',
    workload: { qps: 10000, readRatio: 0.95 },
    requirements: [
      req.qps(10000, 'One primary can\'t serve all the reads. Copy the data.'),
      R('durability', 'Data survives losing one database machine', { type: 'durability', gte: 2 }, 'You need a second copy of the data, kept up to date continuously.'),
    ],
    palette: ['client', 'lb', 'app', 'db', 'replica', 'multi-master', 'cache', 'big-server', 'nosql'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Users viewing profiles.'),
        N('lb', 'lb', X[1], 120, 'Balances the app tier.'),
        N('app', 'app', X[2], 120, 'Routes writes to the primary and spreads reads across all copies.', { count: 6 }),
        N('db', 'db', X[3], 40, 'The primary (leader): the only node that accepts writes.'),
        N('replica', 'replica', X[3], 220, 'Three followers apply the primary\'s change log and serve reads.', { count: 3 }),
      ],
      edges: [
        E('client', 'lb'),
        E('lb', 'app'),
        E('app', 'db', 'Writes (and some reads) go to the primary.'),
        E('app', 'replica', 'Reads go to replicas.'),
        E('db', 'replica', 'Asynchronous replication: the primary streams its WAL/binlog to each follower.'),
      ],
    },
    wrong: {
      'multi-master': W.multiMaster,
      'big-server': W.bigServer,
    },
  },
  guided: [
    {
      title: 'Reads are crushing the primary',
      tag: 'problem',
      body: ['9,500 reads/s + writes on one SQL primary ≈ 10.5k units against a 4k ceiling. And there is exactly one copy of the data.'],
      add: ['client', 'lb', 'app', 'db'],
      predict: {
        question: 'The disk under this database fails. What do you lose?',
        options: ['Nothing', 'Everything since the last backup', 'Only the last second'],
        answer: 1,
        explain: 'One copy = backups are your only durability. Restoring takes hours and loses recent writes.',
      },
    },
    {
      title: 'Add read replicas',
      tag: 'technique',
      body: [
        'The primary streams its write-ahead log to **replicas**, which replay it. Now there are 4 copies of the data, and reads can go to any of them.',
        'Writes still go only to the primary.',
      ],
      add: ['replica'],
      keyIdea: 'Replication scales reads and durability. It does NOT scale writes: every replica must apply every write.',
    },
    {
      title: 'Replication lag',
      tag: 'tradeoff',
      body: [
        'Async replication means replicas are a few ms – seconds behind. A user edits their bio, refreshes, and the replica shows the old one.',
        'Fixes: read-your-own-writes from the primary for a short window, or route by session to a replica that has caught up (GTID/LSN).',
      ],
      keyIdea: 'Async = fast writes, possible stale reads and (on failover) lost recent writes. Sync = no loss, slower writes, and a slow replica blocks the primary.',
    },
    {
      title: 'Lose a replica',
      tag: 'failure',
      kill: ['replica'],
      body: [
        'A replica dies. The app doesn\'t know, so its share of reads waits for a connection timeout. Those waiting requests hold threads, the app\'s pools fill up and **even writes start failing** — a small failure cascades.',
        'Fix: put a health-checking DB proxy (ProxySQL, PgBouncer, RDS Proxy) or a smart driver between the app and the replicas so dead ones are skipped in milliseconds.',
      ],
      predict: {
        question: 'Now kill the primary instead (with replicas still alive). Do writes keep working?',
        options: ['Yes, a replica takes over automatically', 'No — someone (or something) has to promote a replica', 'Writes go to replicas'],
        answer: 1,
        explain: 'Replicas are copies, not leaders. Automatic promotion needs a failover manager / consensus (pattern 16).',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: ['Primary + N replicas: reads scale out, data survives a machine. Writes stay on one node and failover needs extra machinery. Caches and replicas are complementary: cache for hot keys, replicas for broad read capacity.'],
    },
  ],
  quiz: [
    {
      id: 'rep-q1',
      q: 'Your workload is 80% writes and the primary is saturated. Will adding read replicas help?',
      options: ['Yes, a lot', 'Barely — replicas don\'t take writes and must apply every write too', 'Yes, if they are synchronous', 'Only with a cache'],
      answer: 1,
      why: 'Replicas offload reads. Write-heavy load needs partitioning (sharding) or a different store.',
    },
    {
      id: 'rep-q2',
      q: 'A user updates their name and immediately sees the old one. Most likely cause?',
      options: ['Cache stampede', 'Reading from a lagging async replica', 'DNS TTL', 'Split brain'],
      answer: 1,
      why: 'Classic read-your-writes violation. Pin that user\'s reads to the primary for a few seconds after a write.',
    },
    {
      id: 'rep-q3',
      q: 'What is the main risk of async replication during failover?',
      options: ['Replicas become read-only', 'Writes acknowledged by the old primary but not yet replicated are lost', 'Reads get slower', 'Nothing'],
      answer: 1,
      why: 'Async replication trades a small window of potential data loss for write latency.',
    },
  ],
  challenge: {
    id: 'rep-wiki',
    title: 'Encyclopedia article service',
    context: 'A wiki serves 12,000 req/s with 97% reads; edits are rare. Articles must survive a lost machine. Editors accept that readers see an edit a second late.',
    workload: { qps: 12000, readRatio: 0.97 },
    requirements: [req.qps(12000), R('durability', 'Data survives losing one database machine', { type: 'durability', gte: 2 }, 'Keep continuously updated copies.')],
    palette: ['client', 'lb', 'app', 'db', 'replica', 'multi-master', 'big-server', 'shard', 'shard-router'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Readers and editors.'),
        N('lb', 'lb', X[1], 120, 'Balances the app tier.'),
        N('app', 'app', X[2], 120, '8 app servers.', { count: 8 }),
        N('db', 'db', X[3], 40, 'Primary takes the rare edits.'),
        N('replica', 'replica', X[3], 220, '4 replicas carry the read load.', { count: 4 }),
      ],
      edges: [E('client', 'lb'), E('lb', 'app'), E('app', 'db'), E('app', 'replica'), E('db', 'replica')],
    },
    wrong: {
      'multi-master': W.multiMaster,
      'big-server': W.bigServer,
      shard: { why: 'Sharding splits data to scale writes. Edits are rare here — you would pay cross-shard complexity for nothing.', instead: 'Read replicas.' },
      'shard-router': { why: 'There is no write bottleneck to partition.', instead: 'Read replicas.' },
    },
  },
};

export const sharding: Pattern = {
  id: 'sharding',
  num: 5,
  title: 'Sharding (Partitioning)',
  group: 'Data',
  tagline: 'When one primary can\'t take the writes, split the data so each machine owns a slice.',
  minutes: 12,
  level: 'Intermediate',
  signals: ['"write-heavy"', '"billions of rows / TBs of data"', '"one DB can\'t keep up"', 'natural partition key (user_id, tenant_id)'],
  learn: ['Partition keys and routing', 'Why sharding scales writes', 'Hot shards & cross-shard queries', 'Each shard is still a SPOF unless replicated'],
  realWorld: [
    { who: 'Instagram', how: 'Thousands of logical Postgres shards keyed by user id, mapped to physical servers.' },
    { who: 'Discord', how: 'Messages partitioned by (channel_id, time bucket) in Cassandra → ScyllaDB.' },
    { who: 'Vitess (YouTube)', how: 'A routing layer (vtgate) in front of many MySQL shards.' },
  ],
  scenario: {
    id: 'shard-telemetry',
    title: 'Ride-hailing location updates',
    context: 'Drivers send GPS pings: 7,000 req/s, 50% writes. Each write costs the DB 2 units (index + WAL). One SQL primary handles ~4,000 units/s. Reads are per-driver lookups by driver_id.',
    workload: { qps: 7000, readRatio: 0.5 },
    requirements: [
      req.qps(7000, 'Writes are the bottleneck. Replicas won\'t help — split the data.'),
      req.has('shard', 'Scale writes horizontally (≥ 3 partitions)', 'Partition by driver_id across several databases.', 3),
    ],
    palette: ['client', 'lb', 'app', 'db', 'replica', 'shard-router', 'shard', 'mod-hash', 'multi-master', 'big-server', 'cache'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Driver apps.'),
        N('lb', 'lb', X[1], 120, 'Balances the API tier.'),
        N('app', 'app', X[2], 120, '5 stateless API servers.', { count: 5 }),
        N('shard-router', 'shard-router', X[3], 120, 'Maps driver_id → shard (directory or range map), so the app doesn\'t hard-code topology.'),
        N('shard', 'shard', X[4], 120, '4 shards each own ~¼ of drivers: ~2.6k units each.', { count: 4 }),
      ],
      edges: [E('client', 'lb'), E('lb', 'app'), E('app', 'shard-router', 'Every query carries the partition key.'), E('shard-router', 'shard', 'Routed to exactly one shard — no fan-out for single-key queries.')],
    },
    wrong: {
      replica: { why: 'Replicas copy every write, so they add read capacity but zero write capacity. Writes are the problem here.', instead: 'Shards.' },
      'multi-master': W.multiMaster,
      'big-server': W.bigServer,
      'mod-hash': { why: W.modHash.why + ' With growing fleets you will reshard often.', instead: 'A shard map/directory, or consistent hashing.' },
      db: { why: 'A single primary tops out at ~4k units/s; this workload needs ~10.5k.', instead: 'Several shards behind a router.' },
    },
  },
  extras: {
    nodes: [N('x-db', 'db', X[3], 120, 'One primary for everything.')],
    edges: [E('app', 'x-db', undefined, 'shard-router')],
  },
  guided: [
    {
      title: 'Writes hit a wall',
      tag: 'problem',
      body: ['3,500 writes/s × 2 units + 3,500 reads ≈ **10.5k units** on one primary rated for 4k. There\'s no read hot-spot to cache — every ping is new data.'],
      add: ['client', 'lb', 'app', 'x-db'],
      predict: {
        question: 'Which helps most?',
        options: ['Read replicas', 'A cache', 'Split the data across machines'],
        answer: 2,
        explain: 'Replicas and caches only offload reads. To scale writes, each machine must own only part of the data.',
      },
    },
    {
      title: 'Partition by driver_id',
      tag: 'technique',
      body: [
        'Pick a **partition key** that every query carries and that spreads load evenly: `driver_id`. A **router** maps keys to shards (range map, directory, or hash).',
        'Four shards → each sees ~¼ of the writes.',
      ],
      add: ['shard-router', 'shard'],
      remove: ['x-db'],
      keyIdea: 'Sharding multiplies write capacity by the number of shards — as long as the key spreads load evenly and queries rarely span shards.',
    },
    {
      title: 'Hot shards & cross-shard queries',
      tag: 'tradeoff',
      body: [
        'A celebrity user, or partitioning by date, sends most traffic to one shard. Choose high-cardinality keys; add a salt for known hot keys.',
        '"Top 10 drivers by distance across the city" now fans out to every shard. Joins and transactions across shards are hard — design so common queries stay on one shard.',
      ],
      keyIdea: 'The partition key is the most important decision. Wrong key = hot spots or scatter-gather everywhere.',
    },
    {
      title: 'A shard dies',
      tag: 'failure',
      kill: ['shard'],
      body: ['The router can\'t send driver 42\'s data anywhere else — only one shard owns it.'],
      predict: {
        question: '1 of 4 shards is down. What fails?',
        options: ['Nothing', 'About ¼ of requests (that shard\'s keys)', 'Everything'],
        answer: 1,
        explain: 'Partitioning limits the blast radius but doesn\'t add redundancy. Real systems replicate every shard (primary + replicas per shard).',
      },
    },
    {
      title: 'Recap',
      tag: 'recap',
      body: ['Sharding = horizontal scaling for state. Router + N shards, chosen by a partition key. Combine with replication per shard for durability, and with consistent hashing (next) to make resharding cheap.'],
    },
  ],
  quiz: [
    {
      id: 'shard-q1',
      q: 'Which is the best shard key for a multi-tenant SaaS where every query is scoped to one tenant?',
      options: ['created_at', 'tenant_id', 'country', 'a random UUID per row'],
      answer: 1,
      why: 'tenant_id keeps each tenant\'s queries on one shard and spreads tenants evenly (watch out for giant tenants).',
    },
    {
      id: 'shard-q2',
      q: 'Why is sharding by created_at month usually a bad idea for writes?',
      options: ['Dates are strings', 'All new writes land on the newest shard (hot shard)', 'Months have different lengths', 'It prevents indexing'],
      answer: 1,
      why: 'Time-based keys concentrate current traffic on one partition.',
    },
    {
      id: 'shard-q3',
      q: 'What does sharding NOT give you by itself?',
      options: ['Write scaling', 'Smaller indexes per node', 'Redundancy if a shard dies', 'Parallelism'],
      answer: 2,
      why: 'Each shard owns its data exclusively; it needs its own replicas for durability/HA.',
    },
  ],
  challenge: {
    id: 'shard-chat',
    title: 'Chat message store',
    context: 'A chat app stores 4,800 messages/s (60% of 8,000 req/s are writes) and reads recent messages per conversation. Partition key: conversation_id.',
    workload: { qps: 8000, readRatio: 0.4 },
    requirements: [req.qps(8000), req.has('shard', 'Messages are partitioned across ≥ 4 databases', 'Write volume needs several primaries.', 4)],
    palette: ['client', 'lb', 'app', 'db', 'replica', 'shard-router', 'shard', 'mod-hash', 'multi-master', 'cache', 'queue'],
    reference: {
      nodes: [
        N('client', 'client', X[0], 120, 'Chat clients.'),
        N('lb', 'lb', X[1], 120, 'Balances the API tier.'),
        N('app', 'app', X[2], 120, '5 API servers.', { count: 5 }),
        N('shard-router', 'shard-router', X[3], 120, 'conversation_id → shard.'),
        N('shard', 'shard', X[4], 120, '5 shards at ~2.6k units each.', { count: 5 }),
      ],
      edges: [E('client', 'lb'), E('lb', 'app'), E('app', 'shard-router'), E('shard-router', 'shard')],
    },
    wrong: {
      replica: { why: 'This is write-heavy. Replicas multiply reads, not writes.', instead: 'Shards.' },
      'multi-master': W.multiMaster,
      'mod-hash': W.modHash,
      db: { why: 'One primary can\'t absorb ~11k write units/s.', instead: 'Shards behind a router.' },
    },
  },
};
