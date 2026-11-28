import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'sticky-lb',

  problem: {
    why: 'Session affinity exists because an app keeps per-user state in **process memory** (an `HttpSession`, a PHP session file, a websocket room, a warm local cache) and only works if every request from that user returns to the same server. Rather than move the state, you teach the load balancer to remember "user X lives on server 3". It is tempting because it needs zero app changes; it is a trap because the state is still on one box, so balancing, scaling, deploys and failover all quietly stop working the way you assume.',
    withoutIt: [
      'An app with in-memory sessions logs users out or loses their cart on every request that lands on a different server.',
      'Multi-step flows that keep state in RAM (wizards, uploads in chunks, OAuth state) fail randomly at 1 − 1/N rate.',
      'Socket.IO / SockJS long-polling fallbacks break: successive HTTP polls of one logical session hit different servers ("Session ID unknown").',
      'Per-node caches (compiled templates, user data) get a 1/N hit rate instead of near 100% for a user’s data.',
    ],
    position: 'A normal LB (usually L7) with an extra lookup before balancing: identify the client (cookie, source IP, header), look up or decode its pinned backend, and only run the balancing algorithm for new or orphaned clients.',
    diagram: {
      type: 'flow',
      title: 'Affinity short-circuits balancing',
      nodes: [
        { label: 'Request', sub: 'cookie SERVERID=app3' },
        { label: 'Identify client', sub: 'cookie / source IP', tone: 'info' },
        { label: 'Affinity lookup', sub: 'stick table or cookie', tone: 'warn' },
        { label: 'Balancer', sub: 'skipped if pinned', tone: 'neutral' },
        { label: 'app3', sub: 'even at 95% CPU', tone: 'bad' },
      ],
      caption: 'The algorithm only runs for first-time or orphaned clients; everyone else bypasses it.',
    },
  },

  architecture: {
    overview: 'Three families. **LB-inserted cookie**: the LB sets a cookie naming (or encrypting) the chosen server, and later requests decode it; stateless for the LB and survives LB failover. **Stick table / source-IP**: the LB stores client key → server in memory with an expiry (HAProxy stick tables, NLB source-IP stickiness, kube-proxy `ClientIP`), or hashes the IP so no table is needed. **Application cookie / route suffix**: the app’s own session ID carries the node (Tomcat `jvmRoute` appends `.node1` to `JSESSIONID`), and the LB routes on it.',
    diagram: {
      type: 'compare',
      title: 'How affinity is encoded',
      columns: [
        { name: 'LB cookie', points: ['AWSALB, SERVERID', 'Per browser, L7 only', 'No shared LB state', 'Breaks for cookie-less clients'], tone: 'info' },
        { name: 'Source IP', points: ['ip_hash, stick on src', 'Works at L4', 'NAT lumps 1000s together', 'Moves when IP changes'], tone: 'warn' },
        { name: 'App cookie', points: ['JSESSIONID.node1', 'App controls lifetime', 'Couples app to LB', 'Legacy Java EE pattern'], tone: 'neutral' },
      ],
    },
    blocks: [
      { name: 'Client identifier', what: 'Cookie value, source IP (NGINX `ip_hash` uses only the first three octets of IPv4, i.e. a whole /24), or an arbitrary header/URL param hashed by `hash $cookie_x consistent`.' },
      { name: 'Affinity store', what: 'Either in the LB (HAProxy `stick-table type ip size 1m expire 30m`, synced to peers) or in the cookie itself (ALB encrypts the target into `AWSALB`), which avoids replicated LB state.' },
      { name: 'Expiry / duration', what: 'ALB duration-based stickiness: 1 s to 7 days, default 1 day. Kubernetes `sessionAffinityConfig.clientIP.timeoutSeconds` default 10800 (3 h). Longer duration = longer that imbalance persists.' },
      { name: 'Fallback (redispatch)', what: 'When the pinned server is down or drained, the LB picks a new one and rewrites the cookie (HAProxy `option redispatch`, ALB automatically). The user’s in-memory state is not coming with them.' },
      { name: 'Stateful backend', what: 'The reason affinity exists: session objects in heap, local file sessions, an open WebSocket, a game simulation, or a warm per-user cache.' },
    ],
    real: [
      { name: 'AWS ALB / NLB', how: 'ALB target-group stickiness: **duration-based** with an LB-generated `AWSALB` cookie (plus `AWSALBCORS` for cross-origin), or **application-based** keyed on your app cookie with an ALB-generated `AWSALBAPP-*` cookie. If the target becomes unhealthy or deregisters, ALB routes elsewhere and resets the cookie. NLB offers source-IP stickiness only.' },
      { name: 'HAProxy', how: '`cookie SERVERID insert indirect nocache` with `cookie s1` per server inserts a cookie on first response; `stick-table` + `stick on src` (or on a header/cookie) keeps an in-memory map, synchronised to other HAProxy nodes via the `peers` section so LB failover keeps affinity. `option redispatch` breaks persistence when the server is down.' },
      { name: 'NGINX', how: 'Open source: `ip_hash` (IPv4 /24 granularity) or `hash $cookie_sessionid consistent`. NGINX Plus adds `sticky cookie`, `sticky route` (route from a cookie or URL, e.g. jvmRoute) and `sticky learn` (learns the session ID from the app’s response).' },
      { name: 'Kubernetes', how: 'Service `sessionAffinity: ClientIP` implemented by kube-proxy (iptables `recent` module or IPVS persistence) with a 3 h default timeout; ingress-nginx supports cookie affinity via the `nginx.ingress.kubernetes.io/affinity: cookie` annotation.' },
    ],
  },

  lifecycle: {
    summary: 'A returning user with an ALB/HAProxy affinity cookie. The affinity itself is cheap; the cost shows up later as imbalance and lost sessions, not as per-request latency.',
    stages: [
      { stage: 'Accept + parse', what: 'L7 LB terminates TLS and parses headers, which is required to read cookies (L4 can only use the IP).', cost: 'same as any L7 LB', ms: 0.05, part: 'listener' },
      { stage: 'Extract identifier', what: 'Find `SERVERID` / `AWSALB` in the `Cookie` header, or take the source IP.', cost: 'µs', ms: 0.01, part: 'identify' },
      { stage: 'Affinity lookup', what: 'Decrypt/decode the cookie or look up the stick table; check the target is still registered and healthy.', cost: 'µs (hash lookup / decrypt)', ms: 0.01, part: 'affinity' },
      { stage: 'Redispatch (only if needed)', what: 'If the pinned target is gone, run the normal algorithm and mark the response to set a new cookie. In-memory state is lost here.', cost: 'µs; user-visible logout', ms: 0.01, part: 'balancer' },
      { stage: 'Forward to pinned backend', what: 'Proxy over a keep-alive connection to the pinned server, regardless of its current load.', cost: '~0.3 ms intra-AZ hop', ms: 0.3, part: 'backend' },
      { stage: 'Set / refresh cookie', what: 'On the response the LB inserts or refreshes the affinity cookie (duration-based cookies are re-issued with a new expiry).', cost: 'µs', ms: 0.01, part: 'affinity' },
    ],
  },

  deepDives: [
    {
      title: 'Why it breaks: the load-balancing math',
      hook: 'Affinity freezes the assignment made at first contact; load is decided by who arrived when, not by capacity.',
      body: [
        'With stickiness, the balancer only acts on **new sessions**. Every existing session stays where it was, so the real load per server is the sum of its sessions’ activity, which varies by orders of magnitude between users (a bot, a power user, an integration polling every second).',
        '**Source-IP affinity makes it far worse**: corporate proxies and carrier-grade NAT put thousands of users behind one IP, and NGINX `ip_hash` hashes the /24, so one large customer becomes one hot server. Mobile users change IPs when switching networks and silently lose their session.',
        '**Autoscaling does not rebalance**. New instances receive only new sessions; with a 1-day cookie duration, the overloaded servers stay overloaded for hours after scale-out, which is exactly when you needed relief.',
      ],
      diagram: {
        type: 'compare',
        title: 'Scale-out with and without affinity',
        columns: [
          { name: 'Sticky (1-day cookie)', points: ['4 old servers at 90%', '4 new servers at 10%', 'Relief only for new users', 'Old hosts can still fall over'], tone: 'bad' },
          { name: 'Stateless + least-request', points: ['All 8 servers ~50%', 'Next request goes anywhere', 'Relief within seconds', 'Drains in seconds'], tone: 'ok' },
        ],
      },
      insight: 'Affinity also blinds least-connections and P2C: the algorithm may "see" an overloaded host, but pinned traffic bypasses the decision, so the LB cannot protect a struggling server.',
    },
    {
      title: 'Why it breaks: deploys, scale-in and failover',
      hook: 'The pinned server is a per-user single point of failure, and every deploy is a failure of every server.',
      body: [
        'When a server dies, ALB or HAProxy redispatch its users to another server and rewrite the cookie, so the LB keeps working. The **state does not move**: carts, login sessions and in-progress flows on that server are gone.',
        'Draining becomes impossible to do well: either wait until all sessions on the server expire (hours, so deploys take a day) or cut them (users notice every deploy). Scale-in has the same dilemma, so teams disable scale-in and pay for idle capacity.',
        'Session replication (e.g. Tomcat `DeltaManager` all-to-all) moves the problem: every session write is broadcast to every node, which scales as O(N) per write and caps cluster size at a handful of nodes.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Server failure with sticky in-memory sessions',
        actors: ['User', 'LB', 'app3', 'app1'],
        messages: [
          { from: 'User', to: 'LB', label: 'POST /cart (SERVERID=app3)' },
          { from: 'LB', to: 'app3', label: 'pinned', tone: 'warn' },
          { from: 'app3', to: 'LB', label: 'crash / deploy', tone: 'bad', dashed: true },
          { from: 'User', to: 'LB', label: 'GET /checkout' },
          { from: 'LB', to: 'app1', label: 'redispatch, new cookie' },
          { from: 'app1', to: 'User', label: 'no session: login again', tone: 'bad', dashed: true },
        ],
      },
      insight: 'Affinity hides a correctness bug behind a routing rule. It is easy to add and very hard to remove later, because years of code assume the session is local.',
    },
    {
      title: 'The right default: externalise the state',
      hook: 'Make any server able to serve any request, and plain round-robin or P2C works again.',
      body: [
        '**External session store**: keep session data in Redis/Valkey or DynamoDB keyed by an opaque session ID cookie. A Redis `GET` in the same AZ costs ~0.2–0.5 ms; Spring Session, express-session and PHP’s Redis handler do it with configuration, not rewrites. Make the store HA (replicas, Multi-AZ) because it is now critical.',
        '**Signed tokens (JWT / encrypted cookies)**: put small, mostly-immutable claims in the token and verify with a key on every request (~0.05 ms). No store lookup, but revocation needs short expiry plus a denylist, and cookies are limited to ~4 KB.',
        'Once servers are stateless, use least-request or P2C, short draining windows, and autoscaling that helps immediately.',
      ],
      code: {
        lang: 'bash',
        caption: 'Session in Redis: the whole "infrastructure change"',
        code: `# write on login / update (sliding 30-minute expiry)
SET sess:9f1c2e  '{"uid":42,"cart":[123,456]}'  EX 1800
# read on every request from ANY app server
GET sess:9f1c2e
EXPIRE sess:9f1c2e 1800
# logout / revoke
DEL sess:9f1c2e`,
      },
      insight: 'Keep the session small and move large or durable data (carts, drafts) into proper tables. A 50 KB session read on every request turns the session store into your bandwidth bottleneck.',
    },
    {
      title: 'When affinity IS right',
      hook: 'Affinity for performance with a correct fallback is good engineering; affinity for correctness is a trap.',
      body: [
        '**Cache locality with bounded-load consistent hashing**: route by a key (user, tenant, video ID) so the same node keeps it warm, and cap each node at c × average load so hot keys spill over. HAProxy `hash-type consistent` + `hash-balance-factor`; Vimeo used it to stop cache-node overload. Correctness never depends on the hit.',
        '**WebSockets and long-lived connections** are inherently pinned once established; affinity matters only for multi-request handshakes (Socket.IO polling before upgrade). Pair it with a pub/sub backplane (Redis adapter) so any node can deliver to any user.',
        '**Stateful game or collaboration servers**: a match or document is simulated on one authoritative process. Route by **session/room ID through a matchmaker or directory** (Agones allocation, a room→node map), not by cookie, and checkpoint state so a node loss is recoverable.',
      ],
      table: {
        caption: 'Legitimate vs illegitimate affinity',
        columns: ['Use', 'Key', 'If the node dies', 'Verdict'],
        rows: [
          ['In-memory login session', 'cookie', 'User logged out', 'Externalise instead'],
          ['Per-user warm cache', 'consistent hash (bounded)', 'Cache miss, still correct', 'Good'],
          ['WebSocket connection', 'the TCP connection', 'Client reconnects anywhere', 'Fine with backplane'],
          ['Game match / doc room', 'room ID via directory', 'Restore from checkpoint', 'Good, route by ID'],
          ['Socket.IO polling', 'cookie during handshake', 'Reconnect', 'Needed, or force WS-only'],
        ],
      },
      insight: 'Ask: "if this key moves to another node right now, is the result still correct?" If yes, affinity is an optimisation you can keep. If no, you have hidden state that needs a home.',
    },
    {
      title: 'Configuring it safely when you must',
      hook: 'Migrating a legacy app off affinity takes time; meanwhile, limit the damage.',
      body: [
        'Prefer **cookie** over source-IP affinity (NAT), keep duration short (minutes to hours, not the 1-day default), enable redispatch so dead servers do not black-hole users, and use slow start so newly added servers ramp up. Monitor per-target request skew, not just averages.',
      ],
      code: {
        lang: 'text',
        caption: 'HAProxy: cookie affinity with redispatch and bounded fallbacks',
        code: `backend app
    balance leastconn
    option redispatch            # re-pick if pinned server is down
    retries 2
    cookie SERVERID insert indirect nocache maxidle 30m maxlife 8h
    server app1 10.0.1.11:8080 check cookie a1 slowstart 30s
    server app2 10.0.1.12:8080 check cookie a2 slowstart 30s
    server app3 10.0.1.13:8080 check cookie a3 slowstart 30s`,
      },
      insight: 'Treat stickiness as a migration aid with an end date: add the external session store, dual-write for one session lifetime, then turn affinity off.',
    },
  ],

  scaling: {
    body: [
      'Sticky LBs scale like any LB (VRRP pairs, anycast, managed multi-AZ), and cookie-encoded affinity needs no shared LB state. HAProxy stick tables must be synced between LB peers, or an LB failover silently remaps every client.',
      'The backends are what stop scaling: capacity added by autoscaling is only used by new sessions, scale-in destroys sessions, and per-server load becomes a function of history. Cross-region failover is worse: in-memory sessions cannot follow users to another region at all.',
    ],
    bullets: [
      'Load skew metric: max / mean requests per target; above ~1.5 the affinity is costing you capacity.',
      'Affinity duration bounds how long imbalance lasts after scale-out (ALB default 1 day).',
      'Stick tables need `peers` sync, or LB failover remaps everyone.',
      'Externalised sessions turn scale-out from hours to seconds and make multi-region possible (with a replicated store).',
      'Bounded-load hashing keeps locality benefits without unbounded hot spots.',
    ],
  },

  failures: [
    { name: 'Hot server from NAT or heavy users', symptom: 'One target at 100% CPU and rising p99 while others idle; a large customer behind one egress IP all pinned together.', detect: 'Per-target `RequestCount` (ALB) or HAProxy `stot`/`scur` per server: max/mean > 1.5; CPU skew across the auto-scaling group.', mitigate: 'Cookie instead of IP affinity, bounded-load hashing, or remove affinity by externalising sessions.' },
    { name: 'Lost sessions on failure or deploy', symptom: 'Spikes of logouts, empty carts and "session expired" errors aligned with deploys or instance replacement.', detect: 'Login rate and new-session rate spikes correlated with deploy events; 401s after `HealthyHostCount` drops.', mitigate: 'Session store (Redis) or signed tokens; graceful drain is not enough because state cannot be migrated.' },
    { name: 'Scale-out with no relief', symptom: 'Autoscaling adds instances but latency on existing ones stays high for hours.', detect: 'New targets’ request share far below 1/N for long after launch; CPU per instance diverging.', mitigate: 'Stateless servers; meanwhile shorter cookie duration and slow start.' },
    { name: 'Deploys or scale-in take forever', symptom: 'Deregistration waits for session expiry; teams disable scale-in or extend draining to hours.', detect: 'Deregistration delay hitting timeout with active connections; deploy duration trend.', mitigate: 'Externalise state, then short draining (seconds to a minute).' },
    { name: 'Affinity lost on LB failover or IP change', symptom: 'After an LB node restart or mobile network switch, many users are logged out at once.', detect: 'Session-not-found errors after LB events; HAProxy peers sync status; correlation with client IP changes.', mitigate: 'Cookie-based affinity (stateless for LB) or synced stick tables; ultimately remove the need for affinity.' },
  ],

  warStories: [
    {
      title: 'Flash sale: autoscaling that did not help',
      source: 'Composite of common incidents',
      what: 'A retailer with in-memory carts and 1-day ALB stickiness autoscaled from 10 to 30 instances during a sale. The original 10 instances kept all existing shoppers and hit 100% CPU while the 20 new ones idled; two original instances failed health checks, and their shoppers lost carts when redispatched.',
      lesson: 'Stickiness turns autoscaling into "new users only" and turns failures into data loss. Externalise carts and sessions before peak events.',
    },
    {
      title: 'One customer, one server',
      source: 'Composite of common incidents',
      what: 'A B2B SaaS used NGINX `ip_hash`. A new enterprise customer onboarded 8,000 employees behind a single corporate egress proxy; every one of them hashed to the same upstream, which saturated while the cluster average sat at 30%.',
      lesson: 'Source-IP affinity assumes one IP ≈ one user, which NAT and proxies break. Never use IP affinity for user sessions.',
    },
    {
      title: 'Bounded-load consistent hashing for a cache tier',
      source: 'Vimeo engineering, 2016 (HAProxy hash-balance-factor)',
      what: 'Vimeo routed video segment requests by consistent hash to keep cache nodes warm, but popular content overloaded individual nodes. They implemented consistent hashing with bounded loads (Mirrokni et al.) in HAProxy, capping each server relative to the average and spilling over, which evened out load while keeping most of the locality.',
      lesson: 'Affinity done right is an optimisation with a load cap and a correct fallback, not a correctness requirement.',
    },
  ],

  numbers: [
    { label: 'ALB stickiness duration', value: '1 s – 7 days, default 1 day', note: 'how long imbalance can persist' },
    { label: 'Kubernetes ClientIP timeout', value: '10800 s (3 h)', note: '`sessionAffinityConfig.clientIP.timeoutSeconds`' },
    { label: 'NGINX ip_hash key', value: 'first 3 octets of IPv4', note: 'a whole /24 maps to one server' },
    { label: 'Users behind one CGNAT/corporate IP', value: '100s – 1000s', note: 'all pinned together with IP affinity' },
    { label: 'Redis session read (same AZ)', value: '~0.2–0.5 ms', note: 'the cost of removing affinity' },
    { label: 'JWT verify', value: '~0.05 ms', note: 'stateless alternative, no lookup' },
    { label: 'Cookie size limit', value: '~4 KB', note: 'caps what a token-based session can carry' },
  ],

  capacity: {
    question: 'Replace sticky in-memory sessions for 2M concurrent users at 40k req/s with a Redis session store. How big is it?',
    steps: [
      'Data: 2M sessions × ~2 KB (keep sessions small) = ~4 GB, plus Redis overhead (~1.5×) ≈ 6 GB.',
      'Operations: 1 read per request = 40k GET/s; ~10% of requests write (EXPIRE/SET) = ~4k writes/s.',
      'A single Redis primary handles ~100k+ simple ops/s; 44k ops/s is under 50% of one node.',
      'Bandwidth: 40k × 2 KB = 80 MB/s ≈ 640 Mbit/s, fine on a 10 Gbit NIC but the reason to keep sessions small.',
      'HA: primary + replica in another AZ with automatic failover (ElastiCache Multi-AZ); optionally 2–3 shards to cut failover blast radius.',
    ],
    answer: 'One 8–16 GB Redis primary with a cross-AZ replica (or a small 3-shard cluster) carries it with headroom, adding ~0.3 ms per request. In exchange the app tier becomes stateless: even balancing, instant scale-out, seconds-long drains.',
  },

  comparison: {
    caption: 'Ways to handle per-user state',
    columns: ['Approach', 'Where state lives', 'Balance', 'Survives server loss', 'Use when'],
    rows: [
      ['LB cookie stickiness', 'Server RAM', 'Skewed by history', 'No', 'Short-term crutch for legacy apps'],
      ['Source-IP affinity', 'Server RAM', 'Bad under NAT', 'No', 'Non-HTTP protocols needing affinity'],
      ['App cookie / jvmRoute', 'Server RAM (+ replication)', 'Skewed', 'Only with replication', 'Legacy Java EE clusters'],
      ['External session store', 'Redis / DynamoDB', 'Even (any server)', 'Yes', 'Default for web apps'],
      ['Signed token (JWT)', 'Client', 'Even', 'Yes', 'Small claims, stateless APIs'],
      ['Bounded consistent hash', 'Shared store + warm local cache', 'Even within bound', 'Yes (cache miss)', 'Cache locality, sharded workloads'],
    ],
  },

  whenNot: [
    'To make in-memory sessions "work": move the session to Redis/DynamoDB or a signed token instead.',
    'With source-IP affinity for user-facing web traffic: NAT, proxies and mobile IP changes make it both uneven and unreliable.',
    'When you autoscale or deploy often: affinity defeats both; make servers stateless first.',
    'For multi-region active-active: in-memory sessions cannot follow a failover; use a replicated session store or tokens.',
  ],

  interview: [
    {
      q: 'Your app logs users out on every deploy. A teammate proposes sticky sessions. What do you say?',
      a: 'Stickiness hides the bug rather than fixing it: sessions still live in one server’s memory, so deploys, crashes and scale-in still destroy them, and load becomes skewed by session history. The fix is to externalise session state to Redis or DynamoDB (Spring Session, express-session do this with configuration) or use signed tokens for small claims. Then plain least-request balancing, short drains and autoscaling all work. If we need a bridge, cookie stickiness with a short duration and redispatch, with a dated plan to remove it.',
      followUps: ['How big can a session be before this hurts?', 'JWT or Redis — how do you choose?', 'How do you migrate without logging everyone out?'],
      seniorSignal: 'Frames affinity as hidden state and proposes a migration path, not just "use Redis".',
    },
    {
      q: 'Why does source-IP affinity produce uneven load even with a good hash?',
      a: 'The hash is even over IPs, but load is not even over IPs. Carrier-grade NAT and corporate proxies put hundreds or thousands of users behind one address, so one IP can carry a large customer’s entire traffic to one server; NGINX ip_hash even groups the whole /24. Mobile clients change IPs and lose their pin. The unit of balancing is wrong, and the LB cannot correct it because pinned traffic bypasses the algorithm.',
      followUps: ['How would you detect this in production?', 'Does IPv6 fix it?', 'What would you use at L4 instead?'],
      seniorSignal: 'Separates hash uniformity from load uniformity and names NAT/CGNAT concretely.',
    },
    {
      q: 'Is session affinity ever the right choice?',
      a: 'Yes, when it is an optimisation with a correct fallback. Consistent hashing with bounded loads to keep per-key caches warm (as Vimeo did in HAProxy), routing a game match or collaborative document to the process that owns it via a directory, and the handshake phase of Socket.IO polling. The test is whether moving the key to another node right now still gives a correct result; if yes, affinity is fine, if no, there is state that needs a durable home.',
      followUps: ['How does bounded-load hashing work?', 'How do you fail over a stateful game server?', 'How do WebSocket servers deliver messages to users on other nodes?'],
      seniorSignal: 'Gives a crisp criterion (correctness vs performance) and real examples rather than a blanket "never".',
    },
    {
      q: 'You have WebSockets behind a load balancer. Do you need sticky sessions?',
      a: 'An established WebSocket is one TCP connection, so it is pinned by nature; no affinity is needed for it. Affinity is needed only if the transport uses several HTTP requests for one session, like Socket.IO long-polling before the upgrade, or you can force WebSocket-only transport. The real design issue is fan-out: use a pub/sub backplane (Redis adapter, NATS, Kafka) so any node can deliver to any user, and least-connections plus connection recycling to avoid imbalance after scale-out.',
      followUps: ['How do you drain a WebSocket server for deploy?', 'How do you avoid reconnect storms?', 'How do you balance after scale-out?'],
      seniorSignal: 'Distinguishes connection pinning from session affinity and moves the discussion to fan-out and draining.',
    },
    {
      q: 'You inherit a Java EE app with sticky sessions and 1-day cookies. How do you remove the affinity safely?',
      a: 'Add an external session store behind the session API (Spring Session / Tomcat Redis manager), audit what is stored and shrink it, and make all session objects serialisable. Dual-read for one session lifetime: read from Redis, fall back to local memory and migrate on access. Then shorten the stickiness duration, switch the algorithm to least-request, and finally disable affinity, watching login-rate and per-target skew metrics at each step.',
      followUps: ['What breaks when session objects must be serialisable?', 'How do you size Redis?', 'What metrics prove it worked?'],
      seniorSignal: 'Proposes a phased, observable migration with fallback rather than a big-bang switch.',
    },
  ],

  takeaways: [
    'Sticky sessions route around hidden server-side state instead of removing it.',
    'Affinity freezes load by session history; autoscaling and least-request stop helping.',
    'Source-IP affinity is broken by NAT, proxies and mobile networks; never use it for users.',
    'Server loss, deploys and scale-in still destroy pinned state; redispatch only re-routes the user.',
    'Default: stateless servers with sessions in Redis/DynamoDB or small signed tokens.',
    'Affinity is right as a bounded optimisation (cache locality, room/match routing) with a correct fallback.',
  ],
};

export default deep;
