import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'lb',

  problem: {
    why: 'One server has a ceiling (CPU, sockets, NIC) and is a single point of failure. A load balancer puts **one stable address** (a VIP or anycast IP) in front of many interchangeable backends, decides per connection or per request which backend gets the work, and removes dead ones from rotation. It is what makes horizontal scaling and zero-downtime deploys possible.',
    withoutIt: [
      'Clients must know every backend IP; adding or removing a server means a client or DNS change that takes minutes to propagate.',
      'A crashed server keeps receiving its share of traffic until a human notices; nothing ejects it automatically.',
      'Deploys drop in-flight requests, because nobody stops new traffic to a host before it restarts.',
      'Load follows whatever the client or DNS picked, not actual backend load, so one slow host builds a queue and owns your p99.',
      'TLS, HTTP/2, compression and timeouts are re-implemented (differently) on every service.',
    ],
    position: 'Right after DNS (and the CDN, if any): clients resolve a name to the LB’s VIP, the LB terminates TCP (and usually TLS), and opens or reuses connections to a pool of backends. In larger systems it is two tiers: an L4 fleet (ECMP/anycast) in front of an L7 proxy fleet.',
    diagram: {
      type: 'flow',
      title: 'Where the LB sits',
      nodes: [
        { label: 'Client', sub: 'resolves api.example.com' },
        { label: 'DNS', sub: 'returns VIP / anycast IP', tone: 'neutral' },
        { label: 'L4 LB fleet', sub: 'ECMP, Maglev hashing', tone: 'info' },
        { label: 'L7 proxy fleet', sub: 'TLS, routing, retries', tone: 'accent' },
        { label: 'Backend pool', sub: 'stateless app servers', tone: 'ok' },
      ],
      caption: 'Small systems collapse L4 and L7 into one NGINX/HAProxy pair or one managed ALB.',
    },
  },

  architecture: {
    overview: 'Every L7 load balancer is the same machine underneath: a **listener** fed by the kernel (`SO_REUSEPORT` spreading accepts over per-core event loops), an optional TLS layer, an HTTP codec, a **router** matching host/path to a cluster, a **balancer** picking one healthy endpoint, and an **upstream connection pool** per (worker, endpoint). Beside the data path, a **health checker** and a **config source** (file reload, runtime API, or xDS control plane) mutate the endpoint set. L4 LBs drop the codec and router and add a **connection-tracking table** plus a consistent-hash lookup table.',
    diagram: {
      type: 'layers',
      title: 'Anatomy of an L7 load balancer',
      layers: [
        { name: 'Control plane', items: ['Config / xDS', 'Service discovery', 'Health checker', 'Runtime API'], tone: 'violet' },
        { name: 'Ingress', items: ['Listener (VIP:443)', 'SO_REUSEPORT accept', 'TLS + SNI'], tone: 'info' },
        { name: 'Per-worker data plane', items: ['HTTP/1.1 & HTTP/2 codec', 'Router (host/path)', 'Balancer (P2C, hash)', 'Outlier detector'], tone: 'accent' },
        { name: 'Upstream', items: ['Keep-alive conn pools', 'Timeouts & retries', 'Circuit breakers'], tone: 'ok' },
      ],
      caption: 'Health and config flow down from the control plane; requests flow left-to-right through the data plane.',
    },
    blocks: [
      { name: 'Listener + event loop', what: 'One `epoll` loop per worker/core. With `SO_REUSEPORT` the kernel hashes new connections across per-worker accept queues, avoiding a thundering herd on a shared socket.' },
      { name: 'TLS terminator', what: 'Holds certs per SNI name, a session-ticket key (rotated, shared across the fleet so resumption works on any node) and OCSP staples. Full handshakes are the dominant CPU cost of an edge LB.' },
      { name: 'Router / route table', what: 'Ordered match rules (host, path prefix/regex, headers) → cluster. Envoy compiles virtual hosts into a hash lookup by domain then linear path match; ALB evaluates an ordered, prioritised rule list per listener (default quota 100 rules per LB).' },
      { name: 'Endpoint set + balancer', what: 'An immutable snapshot of healthy endpoints with weights, swapped atomically on change. The algorithm (RR, least-request, ring/Maglev hash) keeps its own state: counters, EWMA scores, a hash table.' },
      { name: 'Connection-tracking table (L4)', what: 'Hash map keyed by 5-tuple → chosen backend, so packets of an existing flow keep going to the same backend even when the backend set changes. Bounded size, LRU/timeout eviction.' },
      { name: 'Health checker + outlier detector', what: 'Active probes on a timer (`GET /healthz`) plus passive tracking of real responses (consecutive 5xx, gateway errors, latency). Both feed the same healthy/ejected bit per endpoint.' },
      { name: 'Upstream connection pool', what: 'Per worker, per endpoint: idle keep-alive connections, max-connections/pending/requests circuit breakers, and HTTP/2 multiplexing. Reuse removes a TCP+TLS handshake from most requests.' },
    ],
    real: [
      { name: 'NGINX', how: 'Master process + N single-threaded worker processes (`worker_processes auto`), each an `epoll` loop with `worker_connections` sockets. The `upstream` module offers round-robin, `least_conn`, `ip_hash`, `hash ... consistent` and `random two least_conn`. Without a `zone` directive each worker keeps private counters, so least-conn is per worker. Open source has passive checks only (`max_fails`, `fail_timeout`); active `health_check` and `slow_start` are NGINX Plus. Reload (`SIGHUP`) starts new workers and gracefully retires old ones.' },
      { name: 'HAProxy', how: 'A single process with multiple threads (`nbthread`, default one per CPU since 2.0; `nbproc` removed in 2.5). Rich `balance` algorithms (`roundrobin`, `leastconn`, `random(2)`, `source`, `uri`, `hdr`) with `hash-type consistent`. **Stick tables** are in-memory key→counters stores (rates, conn counts, server id) syncable via `peers`. The **runtime API** on the stats socket changes weights or drains servers live (`set server be/s1 state drain`). Hitless reload hands listening sockets to the new process (`expose-fd listeners`).' },
      { name: 'Envoy', how: 'One main thread (xDS, admin, stats flush) and N worker threads. Each worker owns its connections end-to-end and gets a **thread-local copy** of cluster/endpoint state pushed via TLS slots, so the hot path is lock-free. Consequence: each worker balances independently, with its own least-request counters and its own upstream pools. Supports round-robin, least-request (P2C), ring hash, Maglev, random, plus outlier detection, panic threshold, slow start and zone-aware routing.' },
      { name: 'AWS ELB family', how: '**ALB**: L7, nodes per AZ behind DNS (the LB name resolves to several node IPs that change as it scales); algorithms `round_robin`, `least_outstanding_requests`, `weighted_random` with automatic target weights. **NLB**: L4 on Hyperplane, one static IP per AZ, flow-hash to targets, preserves client IP, TCP idle timeout 350 s. **GWLB**: L3 bump-in-the-wire for firewalls/IDS, GENEVE (UDP 6081) to appliances.' },
      { name: 'Google Maglev / Meta Katran', how: 'Software L4 fleets behind ECMP routers. Maglev (NSDI 2016) runs kernel-bypass on commodity servers, hashes the 5-tuple through a **Maglev lookup table** (default size 65537) so every LB machine picks the same backend, keeps local connection tracking, GRE-encapsulates to backends and lets them reply directly (DSR). Katran does the same in XDP/eBPF, with IP-in-IP encapsulation; Linux IPVS (NAT/DR/TUN modes, `mh` scheduler since 4.18) is the in-kernel equivalent.' },
    ],
  },

  lifecycle: {
    summary: 'One HTTPS request through a two-tier LB (L4 fleet → L7 proxy) on a new client connection, reusing a warm upstream connection. The client-side TCP/TLS round trips are paid regardless; what the LB adds is mostly TLS crypto and one extra intra-AZ hop.',
    stages: [
      { stage: 'ECMP + L4 hash', what: 'The router hashes the 5-tuple across L4 nodes; the L4 node looks up its connection table (miss on SYN), consults the Maglev table and encapsulates to an L7 proxy.', cost: 'µs-level per packet, kernel-bypass or XDP', ms: 0.01, part: 'listener' },
      { stage: 'TCP accept', what: 'The kernel completes the handshake and `SO_REUSEPORT` places the socket on one worker’s accept queue; the worker’s event loop picks it up.', cost: 'one client RTT (paid anyway) + ~20 µs CPU', ms: 0.02, part: 'listener' },
      { stage: 'TLS handshake', what: 'TLS 1.3 full handshake: ECDHE key share + certificate signature (ECDSA P-256 is several times cheaper than RSA-2048). Resumed sessions skip the signature.', cost: '1 client RTT + ~0.1–1 ms CPU', ms: 1.5, part: 'tls' },
      { stage: 'HTTP parse + route', what: 'Decode headers (HPACK for HTTP/2), match host and path to a cluster, apply header rewrites and per-route timeouts.', cost: 'tens of µs', ms: 0.05, part: 'router' },
      { stage: 'Pick endpoint', what: 'Read the worker-local healthy-endpoint snapshot and run P2C: sample two endpoints, choose the one with fewer active requests.', cost: '< 1 µs', ms: 0.01, part: 'algo' },
      { stage: 'Upstream connection', what: 'Take an idle keep-alive connection from this worker’s pool for that endpoint. A cold connection would add TCP (+ TLS if re-encrypting) to the backend.', cost: 'warm ~µs; cold 0.3–1 ms intra-AZ', ms: 0.02, part: 'pool' },
      { stage: 'Forward + backend hop', what: 'Write the request upstream; the extra network hop inside the AZ is the real latency the LB adds to every request.', cost: '~0.1–0.3 ms RTT same AZ', ms: 0.3, part: 'pool' },
      { stage: 'Stream response', what: 'Response headers and body are proxied back (buffered or streamed); passive outlier detection records the status and latency for this endpoint.', cost: 'tens of µs + body transfer', ms: 0.1, part: 'health' },
      { stage: 'Log + stats', what: 'Access log entry and counters written to per-worker buffers, flushed asynchronously.', cost: 'off the hot path', ms: 0.01 },
    ],
  },

  deepDives: [
    {
      title: 'L4 forwarding modes: NAT, DSR, full proxy',
      hook: 'Who sees the client IP, who carries the response bytes, and what can the LB inspect — decided by one choice.',
      body: [
        '**NAT mode** (IPVS-NAT, classic hardware LBs) rewrites the destination IP of each packet to the backend and rewrites the source back on the way out. Both directions traverse the LB, so it needs connection tracking and becomes the bandwidth bottleneck, but backends need no special setup.',
        '**DSR / direct server return** (IPVS-DR, Maglev, Katran, GitHub GLB) forwards only the inbound packets, typically encapsulated (GRE, IP-in-IP, GUE). The backend has the VIP on a loopback interface and replies straight to the client. Since responses are usually 10–100× larger than requests, the LB fleet carries a fraction of the bytes. Downside: it is strictly L4, so no TLS termination, no HTTP routing, no retries.',
        'A **full proxy** (HAProxy/NGINX/Envoy in TCP or HTTP mode, ALB) terminates the client TCP connection and opens a separate one to the backend. It can read and rewrite anything, but the backend sees the proxy’s IP (fix with `X-Forwarded-For` or PROXY protocol), and every upstream connection consumes an ephemeral source port.',
      ],
      diagram: {
        type: 'compare',
        title: 'Three ways to forward',
        columns: [
          { name: 'NAT', points: ['Rewrites dst/src IPs', 'Both directions via LB', 'Needs conntrack', 'Backend unchanged'], tone: 'neutral' },
          { name: 'DSR', points: ['Encapsulates inbound only', 'Backend replies directly', 'VIP on backend loopback', 'L4 only, no TLS'], tone: 'ok' },
          { name: 'Full proxy', points: ['Two TCP connections', 'Sees HTTP, TLS, headers', 'Client IP via XFF/PROXY', 'Ephemeral port per upstream'], tone: 'accent' },
        ],
      },
      insight: 'A full proxy connecting to one backend IP:port is limited by the ~28k default ephemeral ports (`net.ipv4.ip_local_port_range` 32768–60999) per source IP; high-churn proxies hit **SNAT port exhaustion** long before CPU. Keep-alive reuse, multiple source IPs, or more backend IPs fix it.',
    },
    {
      title: 'L4 at fleet scale: ECMP, Maglev hashing, connection tracking',
      hook: 'How Google, Meta and GitHub run stateless-ish L4 fleets where any LB node can die without breaking connections.',
      body: [
        'Routers announce the VIP via BGP from every LB node and spread packets with **ECMP**, hashing the 5-tuple to a next hop. When an LB node is added or removed the ECMP hash changes and some flows land on a **different LB node** mid-connection.',
        'If each LB node picked backends independently, that new node would choose a different backend and the connection would reset. Maglev solves it with **consistent hashing that every node computes identically**: the lookup table is a deterministic function of the backend set, so a flow that moves between LB nodes still maps to the same backend.',
        'Each node also keeps a local **connection-tracking table** (5-tuple → backend) so that when the backend set changes, existing flows on that node stay put. The two mechanisms cover each other: conntrack protects flows from backend changes, consistent hashing protects them from LB-node changes. Only the rare case of both at once breaks a flow.',
        'Maglev’s table: each backend generates a permutation of the M slots (from an `offset` and `skip` derived from two hashes); backends take turns claiming their next preferred free slot until the table is full. Result: near-perfectly even slot counts and minimal disruption when a backend leaves.',
      ],
      diagram: {
        type: 'sequence',
        title: 'A flow survives an LB node failure',
        actors: ['Client', 'Router', 'LB-A', 'LB-B', 'Backend 7'],
        messages: [
          { from: 'Client', to: 'Router', label: 'SYN to VIP' },
          { from: 'Router', to: 'LB-A', label: 'ECMP hash → LB-A' },
          { from: 'LB-A', to: 'Backend 7', label: 'maglev[hash] = 7, encap' },
          { from: 'Backend 7', to: 'Client', label: 'SYN-ACK direct (DSR)', dashed: true },
          { from: 'LB-A', to: 'Router', label: 'node dies, BGP withdrawn', tone: 'bad' },
          { from: 'Client', to: 'Router', label: 'next packet' },
          { from: 'Router', to: 'LB-B', label: 'ECMP rehash → LB-B', tone: 'warn' },
          { from: 'LB-B', to: 'Backend 7', label: 'conntrack miss, maglev = 7', tone: 'ok' },
        ],
        caption: 'Same table on every node means LB-B picks the same backend without any shared state.',
      },
      code: {
        lang: 'python',
        caption: 'Maglev table population (simplified from the NSDI 2016 paper)',
        code: `M = 65537                      # prime table size
def populate(backends):
    perm = []
    for b in backends:
        offset = h1(b.name) % M
        skip   = h2(b.name) % (M - 1) + 1
        perm.append([(offset + j * skip) % M for j in range(M)])
    nxt   = [0] * len(backends)
    table = [-1] * M
    filled = 0
    while True:
        for i in range(len(backends)):
            c = perm[i][nxt[i]]
            while table[c] >= 0:          # slot taken, try next preference
                nxt[i] += 1; c = perm[i][nxt[i]]
            table[c] = i; nxt[i] += 1; filled += 1
            if filled == M: return table
# lookup: backend = table[hash(5-tuple) % M]`,
      },
      insight: 'GitHub’s GLB Director took a different route: a stateless table that stores a **primary and secondary** backend per slot, with the backend forwarding unknown flows to the secondary ("second chance"), so even connection tracking on the LB is unnecessary.',
    },
    {
      title: 'Balancing algorithms: RR, least-conn, P2C, EWMA, slow start',
      hook: 'The algorithm decides your tail latency more than the hardware does, especially with many LB instances.',
      body: [
        '**Round-robin** balances request counts, not work; fine when requests are uniform and hosts identical. **Weighted** variants (smooth weighted RR in NGINX) handle mixed instance sizes. **Least-connections / least-outstanding-requests** reacts to in-flight work, so a host stuck on slow calls gets less.',
        'The catch: with many LB instances, each with a partial or stale view, "pick the global minimum" makes everyone pick the **same** idle host at once (herding). **Power of two choices (P2C)** samples two random endpoints and takes the less loaded. Balls-into-bins theory: purely random placement leaves the busiest of n hosts about `log n / log log n` above average; with two choices the gap drops to about `log log n`. Exponentially better, O(1), and robust to stale counters because randomness breaks herds.',
        '**EWMA / peak-EWMA** (Finagle, Linkerd) scores each endpoint by an exponentially weighted latency average × outstanding requests, jumping up instantly on a slow response and decaying slowly. Combined with P2C it routes around a GC-pausing or noisy-neighbour host within a few requests, which pure connection counts miss.',
        '**Slow start** ramps a newly added host’s weight over a window (HAProxy `slowstart 30s`, Envoy `slow_start_config`, ALB slow start 30–900 s) so a cold JVM or empty cache is not hit with its full share instantly.',
      ],
      table: {
        caption: 'Which algorithm when',
        columns: ['Algorithm', 'Signal used', 'Strength', 'Weakness'],
        rows: [
          ['Round-robin / weighted', 'none (position)', 'Simple, predictable, cheap', 'Blind to slow hosts and request cost'],
          ['Least-connections', 'in-flight count', 'Adapts to slow requests, long conns', 'Herds with many LBs; per-worker view'],
          ['P2C least-request', '2 random samples', 'Near-optimal, no herding, O(1)', 'Needs a load signal per endpoint'],
          ['Peak-EWMA + P2C', 'latency × in-flight', 'Avoids GC pauses, noisy hosts', 'Tuning decay; can starve recovering host'],
          ['Ring / Maglev hash', 'hash(key)', 'Affinity, cache locality', 'Hot keys; ignores load unless bounded'],
        ],
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy cluster: P2C least-request with slow start',
        code: `clusters:
- name: api
  lb_policy: LEAST_REQUEST
  least_request_lb_config:
    choice_count: 2              # P2C (the default)
    slow_start_config:
      slow_start_window: 60s
      aggression: { default_value: 1.0, runtime_key: api.ss_aggr }
  common_lb_config:
    healthy_panic_threshold: { value: 50 }   # default 50%`,
      },
      insight: 'In Envoy and NGINX (without `zone`), "least-request" is **per worker thread/process**: a 16-core proxy is really 16 independent balancers with 1/16 of the information each. That is exactly the regime where P2C beats strict least-conn.',
    },
    {
      title: 'Hash-based affinity: ring hash, Maglev, bounded loads',
      hook: 'When the same key must keep hitting the same backend (caches, shards), and how not to melt one host doing it.',
      body: [
        '`hash(key) % N` remaps almost every key when N changes. **Ring hash** (Karger 1997; NGINX `hash $key consistent` is ketama) places each host at many virtual points on a ring; a key goes to the next point clockwise, and removing a host moves only its ~1/N of keys. It needs ~100–200 vnodes per host for even spread and a binary search per lookup.',
        '**Maglev hashing** trades a little disruption for perfect evenness and O(1) lookup through the fixed-size table. Envoy offers both (`RING_HASH`, `MAGLEV`); Maglev is the better default when the table rebuild cost is acceptable.',
        'Pure hashing ignores load, so one hot key or celebrity tenant saturates its host. **Consistent hashing with bounded loads** (Mirrokni et al., Google 2016) caps each host at c × average load and spills to the next host on the ring. HAProxy exposes it as `hash-balance-factor` (e.g. 125 means no server above 125% of average); Vimeo used it to cut cache-tier bandwidth imbalance.',
      ],
      code: {
        lang: 'text',
        caption: 'HAProxy: consistent hash on URI with a load bound',
        code: `backend video_cache
    balance uri
    hash-type consistent
    hash-balance-factor 125
    server c1 10.0.1.11:80 check
    server c2 10.0.1.12:80 check
    server c3 10.0.1.13:80 check`,
      },
      insight: 'Hash affinity must be an **optimisation, never correctness**: if a key moves (host dies, scale-out, bound spill), the new host must still serve it correctly from a shared source of truth.',
    },
    {
      title: 'Health checks: active, passive, flapping, and failing open',
      hook: 'Health checking is where LBs cause outages: by keeping dead hosts, or by ejecting every live one.',
      body: [
        '**Active checks** probe each endpoint on a timer with thresholds: HAProxy defaults `inter 2s fall 3 rise 2`; ALB defaults to 30 s interval, 2 unhealthy / 5 healthy. Time to eject ≈ interval × unhealthy threshold, so ALB defaults react in ~60 s and HAProxy in ~6 s. Asymmetric thresholds (fast out, slow back in) damp **flapping**.',
        '**Passive checks / outlier detection** watch real traffic: Envoy ejects a host after `consecutive_5xx` (default 5) for `base_ejection_time` (30 s, multiplied by the number of prior ejections), capped by `max_ejection_percent` (default 10%). NGINX OSS only has passive: `max_fails=1 fail_timeout=10s`. Passive catches what a shallow `/healthz` cannot, and needs no extra traffic.',
        'The dangerous case: a shared dependency blips, every host fails its (deep) check, and the LB ejects them all, turning a partial outage into a total one. Hence **fail-open**: ALB and NLB route to all targets when none are healthy, and Envoy’s **panic threshold** (default 50%) ignores health entirely once fewer than half the hosts are healthy, spreading load across all of them rather than crushing the survivors.',
      ],
      diagram: {
        type: 'flow',
        title: 'Endpoint health state machine',
        nodes: [
          { label: 'Healthy', sub: 'in rotation', tone: 'ok' },
          { label: 'Failing', sub: '1..fall-1 failed checks', tone: 'warn' },
          { label: 'Ejected', sub: 'after fall / 5 × 5xx', tone: 'bad' },
          { label: 'Recovering', sub: 'rise passes, slow start', tone: 'info' },
          { label: 'Healthy', sub: 'full weight again', tone: 'ok' },
        ],
        caption: 'If more than half the pool is Ejected, Envoy enters panic mode and routes to all hosts.',
      },
      code: {
        lang: 'yaml',
        caption: 'Envoy: active + passive health checking',
        code: `health_checks:
- timeout: 1s
  interval: 5s
  unhealthy_threshold: 3
  healthy_threshold: 2
  http_health_check: { path: /ready }
outlier_detection:
  consecutive_5xx: 5
  interval: 10s
  base_ejection_time: 30s
  max_ejection_percent: 10`,
      },
      insight: 'Make the LB check **readiness of this instance** (can it serve, is it shutting down), not the health of shared dependencies. A dependency check correlates every host’s health and converts a DB blip into "zero healthy targets".',
    },
    {
      title: 'Connection draining and zero-downtime deploys',
      hook: 'Most deploy-time 502s are a race between the LB’s view and the process lifecycle, not a bug in the app.',
      body: [
        'Removing a host safely is a protocol: (1) the host is marked **draining**, so the balancer stops choosing it for new requests/connections, (2) in-flight requests finish, (3) after a deregistration delay the LB closes what is left, (4) only then does the process exit. ALB’s `deregistration_delay.timeout_seconds` defaults to **300 s**; HAProxy does it with `set server be/s1 state drain` on the runtime API.',
        'The common bug: Kubernetes sends `SIGTERM` to the pod **at the same time** as it removes the endpoint, and kube-proxy/ingress/ALB learn about it seconds later. If the app exits immediately, requests routed during those seconds hit a dead socket. The fix is a `preStop` sleep (5–15 s) and graceful shutdown that stops accepting, finishes in-flight work, and sends `Connection: close` / HTTP/2 `GOAWAY` on idle keep-alives.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Graceful removal of one backend',
        actors: ['Deployer', 'LB', 'Old pod', 'New pod'],
        messages: [
          { from: 'Deployer', to: 'New pod', label: 'start, wait for /ready' },
          { from: 'LB', to: 'New pod', label: 'health passes, slow start' , tone: 'ok' },
          { from: 'Deployer', to: 'LB', label: 'deregister old pod' },
          { from: 'LB', to: 'Old pod', label: 'no new requests (draining)', tone: 'warn' },
          { from: 'Old pod', to: 'LB', label: 'finish in-flight, GOAWAY', dashed: true },
          { from: 'Deployer', to: 'Old pod', label: 'SIGTERM after preStop sleep' },
        ],
      },
      insight: 'Set the deregistration delay to slightly above your **longest legitimate request**, not 300 s by default: a 5-minute drain on 100 instances makes every rolling deploy take hours, and teams then "fix" it by disabling draining.',
    },
    {
      title: 'TLS modes, SNI, keep-alive and timeout alignment',
      hook: 'Where encryption ends and how idle connections are timed out decides both your security posture and your 502 rate.',
      body: [
        '**Termination**: the LB decrypts, so it can route on HTTP, add headers and offload crypto; traffic to backends is plaintext or mTLS. **Passthrough**: the LB stays L4 and routes on the **SNI** field read from the unencrypted ClientHello (HAProxy `req.ssl_sni` in `mode tcp`), so the backend owns the cert and end-to-end encryption is preserved, but no HTTP features. **Re-encrypt**: terminate, inspect, then open a new TLS session upstream, the usual compliance answer at the cost of a second handshake (amortised by keep-alive).',
        'Upstream keep-alive is the single biggest latency and CPU win: NGINX needs `keepalive 64;` in the `upstream` plus `proxy_http_version 1.1` and an empty `Connection` header, or it opens a new connection per request.',
        'Keep-alive introduces a race: if the backend closes an idle connection at the same moment the LB sends a request on it, the LB gets a reset and returns 502. Rule: **backend idle timeout > LB idle timeout**. ALB’s idle timeout is 60 s, while Node.js `server.keepAliveTimeout` defaults to 5 s, which is the classic source of sporadic ALB 502s.',
      ],
      code: {
        lang: 'text',
        caption: 'nginx: upstream keep-alive done right',
        code: `upstream api {
    least_conn;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;              # idle conns cached per worker
    keepalive_timeout 50s;     # < backend idle timeout
}
server {
    listen 443 ssl;
    http2 on;
    location / {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}`,
      },
      insight: 'Share the TLS **session-ticket key** across all LB nodes (and rotate it). Otherwise anycast/ECMP sends a returning client to a different node that cannot resume, and every reconnect pays a full handshake.',
    },
    {
      title: 'HTTP/2 and gRPC: long-lived connection imbalance',
      hook: 'An L4 LB balances connections; gRPC sends a million requests down one connection.',
      body: [
        'HTTP/2 multiplexes many requests over one long-lived TCP connection. Behind an **L4** LB (NLB, kube-proxy `ClusterIP`), each client pins to whichever backend its connection landed on. With few, chatty clients, a handful of backends carry everything, and **newly scaled-out backends get no traffic** because nobody reconnects.',
        'Fixes, in order of preference: an **L7 proxy that balances per stream** (Envoy, Linkerd, ALB with gRPC target groups); **client-side balancing** in the gRPC library (`round_robin` over resolved addresses, or xDS-driven proxyless gRPC); and forcing periodic reconnection with server `MaxConnectionAge` (gRPC Go `keepalive.ServerParameters`) plus a grace period, so connections re-spread every few minutes.',
      ],
      diagram: {
        type: 'compare',
        title: 'Same clients, different LB layer',
        columns: [
          { name: 'L4 (per connection)', points: ['3 clients → 3 conns', '3 of 10 backends busy', 'Scale-out adds idle hosts', 'Hot client = hot backend'], tone: 'bad' },
          { name: 'L7 (per stream)', points: ['Proxy keeps conns to all', 'Each RPC balanced (P2C)', 'New hosts used instantly', 'Extra hop, more CPU'], tone: 'ok' },
        ],
      },
      insight: 'The same trap applies to WebSockets and database connection pools: anything long-lived needs **connection recycling** or it keeps the topology it had at connect time, which also makes draining take as long as the longest connection.',
    },
  ],

  scaling: {
    body: [
      'An LB that is a single box is just a new single point of failure. **Active-passive** pairs share a floating VIP through VRRP (keepalived): the master sends adverts every second; after ~3 missed adverts the backup claims the VIP and sends gratuitous ARP. Simple, but half the capacity idles, failover takes seconds, and a network partition can produce split-brain (both claim the VIP).',
      '**Active-active** scales out: either several LB IPs published in DNS (how ALB scales; clients may cache stale node IPs), or **anycast + BGP + ECMP**, where every node announces the same VIP and routers spread flows. Anycast gives sub-second failover by BGP withdrawal and absorbs DDoS, but requires consistent hashing so ECMP churn does not reset flows.',
      'Separate the **control plane** (config, discovery, health aggregation, xDS) from the **data plane**. The data plane must keep serving with its last-known config if the control plane dies (static stability). Config changes should be validated, versioned and rolled out progressively: a bad route pushed instantly to every proxy is a global outage.',
      'Across zones and regions: **cross-zone load balancing** (on by default for ALB, off by default for NLB with inter-AZ data charges) evens load when AZs have unequal target counts. **Global server load balancing** picks the region: DNS-based (Route 53 latency/geo, Akamai GTM) or a single global anycast front door (Google Cloud global external LB, AWS Global Accelerator, Cloudflare).',
    ],
    bullets: [
      'VRRP/keepalived: ~3 s failover, 1 active node, beware split-brain on partitions.',
      'Anycast + ECMP: N active nodes, BGP withdrawal for failover, needs Maglev-style consistent hashing.',
      'DNS across LB nodes: easy, but failover bounded by TTL and client caching.',
      'Without cross-zone: each AZ node splits its traffic only among local targets; 2 targets in AZ-a and 8 in AZ-b means AZ-a targets carry 4× the load per host.',
      'Pre-warm or over-provision managed LBs before flash traffic; they scale on observed load in minutes, not seconds.',
      'Keep the data plane statically stable: last-known-good config, no runtime dependency on the control plane per request.',
      'Two tiers (L4 anycast → L7 proxies) let the L7 tier scale and deploy independently behind a stable IP.',
    ],
    diagram: {
      type: 'layers',
      title: 'Global to local load balancing',
      layers: [
        { name: 'Global (GSLB)', items: ['GeoDNS / latency DNS', 'Global anycast IP', 'Region health'], tone: 'violet' },
        { name: 'Regional L4', items: ['BGP + ECMP', 'Maglev / Katran / NLB', 'Conn tracking'], tone: 'info' },
        { name: 'Regional L7', items: ['Envoy / HAProxy / ALB', 'TLS, routing, retries', 'Cross-zone'], tone: 'accent' },
        { name: 'Backends', items: ['Per-AZ pools', 'Readiness probes', 'Graceful drain'], tone: 'ok' },
      ],
    },
  },

  failures: [
    { name: 'Retry storm amplification', symptom: 'Backends slow down, every LB tier retries timeouts, load multiplies (3 tiers × 3 tries = 27×) and the backend never recovers.', detect: 'Retry ratio climbing: `envoy_cluster_upstream_rq_retry` / `upstream_rq_total`, `upstream_rq_retry_overflow` > 0; backend RPS rising while client RPS is flat.', mitigate: 'Retry budgets (Envoy `retry_budget` ~20% of active requests), retries at one tier only, idempotent requests only, jittered backoff, circuit breakers.' },
    { name: 'All targets ejected', symptom: 'A shared dependency blips, deep health checks fail on every host, the LB has zero healthy targets and returns 503 for everything.', detect: 'ALB `HealthyHostCount` → 0 / `UnHealthyHostCount` spike; Envoy `membership_healthy` dropping together across hosts; `lb_healthy_panic` counter increasing.', mitigate: 'Readiness checks scoped to the instance, fail-open / panic threshold, `max_ejection_percent` cap, alert on correlated ejections.' },
    { name: 'Keep-alive race 502s', symptom: 'Low-rate, random 502s with no backend errors logged, worse at low traffic when connections sit idle.', detect: 'ALB `HTTPCode_ELB_502_Count` with backend `HTTPCode_Target_5XX_Count` flat; Envoy `upstream_cx_destroy_remote_with_active_rq`; nginx "upstream prematurely closed connection".', mitigate: 'Backend idle timeout > LB idle timeout (e.g. Node `keepAliveTimeout` 65 s behind ALB 60 s); retry once on connection reset for idempotent requests.' },
    { name: 'Long-lived connection imbalance', symptom: 'After scale-out the new hosts idle while old ones run hot; per-host CPU spread is wide although the LB "balances".', detect: 'Per-host RPS / active connections skew (max/mean > 1.5); `upstream_cx_active` distribution; new instances with near-zero request count.', mitigate: 'L7 per-request balancing for HTTP/2 and gRPC, `MaxConnectionAge`, least-conn for WebSockets, periodic connection recycling.' },
    { name: 'SNAT / ephemeral port exhaustion', symptom: 'Connect errors and timeouts from the proxy to backends under load; CPU fine; `EADDRNOTAVAIL` in logs.', detect: 'Many sockets in `TIME_WAIT` (`ss -s`), Envoy `upstream_cx_connect_fail`, NAT gateway `ErrorPortAllocation`.', mitigate: 'Upstream keep-alive, more source IPs or backend IPs, widen `ip_local_port_range`, avoid per-request connections.' },
    { name: 'LB failover split-brain or slow failover', symptom: 'Both keepalived nodes claim the VIP after a partition (ARP flapping, resets), or failover stalls for seconds while traffic black-holes.', detect: 'keepalived state transitions in logs, duplicate-ARP alerts, synthetic probe against the VIP failing from multiple vantage points.', mitigate: 'Unicast VRRP with a dedicated link, fencing, or move to anycast/managed LB; test failover regularly.' },
    { name: 'Bad config pushed fleet-wide', symptom: 'A route or cert change breaks every proxy at once: 404s or TLS errors everywhere within seconds.', detect: 'Global 4xx/5xx step change aligned with a config version; xDS `update_rejected` / `update_success` counters; canary proxy error rate.', mitigate: 'Validate configs before push, progressive rollout per zone, automatic rollback on error-rate SLO, keep last-known-good.' },
  ],

  warStories: [
    {
      title: 'Christmas Eve ELB outage',
      source: 'AWS post-event summary, December 24, 2012 (us-east-1)',
      what: 'A maintenance process run against the production ELB control plane by mistake deleted part of the ELB **state data**. The control plane then mis-managed affected load balancers from incomplete state and many existing LBs degraded; recovery required reconstructing state and took most of a day. Netflix streaming was among the high-profile victims.',
      lesson: 'The LB control plane is a dependency of every service behind it. Gate destructive operations, keep data-plane config statically stable, and design for one region’s LB tier failing (multi-region failover).',
    },
    {
      title: 'Sporadic 502s behind ALB',
      source: 'Composite of common incidents',
      what: 'A team migrated a Node.js API behind an ALB. Error rate was ~0.05% 502s with nothing in app logs. Cause: Node’s default `keepAliveTimeout` of 5 s closed idle upstream connections while the ALB (60 s idle timeout) still considered them reusable, so a request occasionally raced a FIN.',
      lesson: 'Align idle timeouts across every hop: each downstream hop must give up before the one behind it. Look at LB-generated vs target-generated 5xx before debugging the app.',
    },
    {
      title: 'gRPC fleet that would not scale out',
      source: 'Composite of common incidents',
      what: 'A gRPC service behind kube-proxy (L4) was autoscaled from 10 to 30 pods during a spike, but latency did not improve: the 40 client pods held long-lived HTTP/2 connections to the original 10, and the 20 new pods received almost nothing.',
      lesson: 'L4 balancing of multiplexed protocols is per-connection. Use an L7 mesh/proxy or client-side LB, and cap connection age so topology changes take effect.',
    },
  ],

  numbers: [
    { label: 'L7 proxy throughput', value: '~10k–100k req/s per core', note: 'small requests, keep-alive; full TLS handshakes cut this sharply' },
    { label: 'Latency added by L7 hop', value: '~0.1–1 ms', note: 'mostly the extra intra-AZ RTT; L4 adds µs' },
    { label: 'Software L4 (Maglev paper)', value: '~10 Gbps line rate per machine', note: 'kernel bypass on commodity servers, 2016' },
    { label: 'Maglev table size', value: '65537 (prime)', note: 'Envoy default; larger M = finer balance, slower rebuild' },
    { label: 'HAProxy check defaults', value: 'inter 2s, fall 3, rise 2', note: '≈ 6 s to eject' },
    { label: 'ALB defaults', value: '60 s idle, 300 s dereg delay', note: 'health check 30 s interval, 2 unhealthy / 5 healthy' },
    { label: 'NLB TCP idle timeout', value: '350 s', note: 'long-idle connections are silently dropped after this' },
    { label: 'Envoy outlier defaults', value: '5 × 5xx, 30 s eject, max 10%', note: 'panic threshold 50% healthy' },
    { label: 'Ephemeral ports per src→dst', value: '~28k', note: 'Linux default range 32768–60999' },
    { label: 'VRRP failover', value: '~3 s', note: '3 × 1 s advert interval + skew' },
    { label: 'P2C max load gap', value: '~log log n vs log n / log log n', note: 'two random choices vs one' },
  ],

  capacity: {
    question: 'Size a self-managed Envoy L7 tier for 200k HTTPS req/s at peak across 3 AZs, with ~1M concurrent client connections, 20% of requests on new TLS connections.',
    steps: [
      'TLS: 20% × 200k = 40k full handshakes/s. With ECDSA P-256 at roughly 5–10k handshakes/s per core (plus key exchange) → ~6–8 cores.',
      'Proxying: 200k req/s at ~15k req/s per core for small keep-alive requests → ~14 cores.',
      'Total ≈ 22 cores busy at peak. Target ≤ 50% utilisation for headroom and losing an AZ → ~44 cores.',
      'Memory: 1M connections × ~20–40 KB (socket buffers + TLS state + HTTP/2 tables) ≈ 20–40 GB across the fleet.',
      'Per AZ, survive one node loss: 3 AZs × 3 nodes × 8 vCPU / 16 GB = 72 vCPU and 144 GB total; after an AZ loss 48 vCPU remain, still above the ~44 needed.',
    ],
    answer: '~9 × 8-vCPU / 16 GB proxies (3 per AZ) behind an L4 tier (NLB or anycast). The binding constraints are TLS handshakes and per-connection memory, not request forwarding; enabling session resumption and longer keep-alive moves the answer more than faster CPUs.',
  },

  comparison: {
    caption: 'Real load balancers and how they differ',
    columns: ['Product', 'Layer', 'Architecture', 'Balancing', 'HA model', 'Best for'],
    rows: [
      ['NGINX', 'L4 + L7', 'Master + single-threaded worker processes', 'RR, least_conn, hash consistent, random two', 'keepalived VIP pair or behind L4', 'Web serving + reverse proxy, simple static configs'],
      ['HAProxy', 'L4 + L7', 'One process, multi-threaded, runtime API', 'roundrobin, leastconn, random(2), bounded hash', 'keepalived VIP, peers-synced stick tables', 'High-performance edge LB, rich health checks'],
      ['Envoy', 'L4 + L7', 'Main thread + per-worker lock-free state, xDS', 'P2C least-request, ring, Maglev, zone-aware', 'Fleet behind L4, control plane pushes config', 'Service mesh, gRPC, dynamic config'],
      ['AWS ALB', 'L7', 'Managed per-AZ nodes behind DNS', 'RR, least outstanding, weighted random', 'Managed multi-AZ, scales automatically', 'HTTP/gRPC on AWS, path routing, auth'],
      ['AWS NLB', 'L4', 'Hyperplane, static IP per AZ', 'Flow hash', 'Managed multi-AZ', 'TCP/UDP, static IPs, millions of conns'],
      ['Maglev / Katran', 'L4', 'ECMP fleet, Maglev hash, DSR, kernel bypass/XDP', 'Consistent hash + conntrack', 'Anycast, N active nodes', 'Hyperscale front door to L7 tier'],
    ],
  },

  whenNot: [
    'In front of a single backend: it adds a hop and a component without adding capacity or redundancy (unless you need TLS offload or are preparing to scale).',
    'Inside a mesh where the client library or sidecar already does per-request balancing (gRPC xDS, Finagle): a central LB adds a hop and a bottleneck; use client-side LB plus discovery.',
    'For multiplexed long-lived protocols (gRPC, HTTP/2) using an L4-only LB: you get per-connection imbalance; use L7 or client-side balancing instead.',
    'For cross-region failover alone: an in-region LB cannot fail over a dead region; use GSLB (latency/failover DNS) or a global anycast front door.',
    'For partitioned/stateful systems (Kafka, Cassandra, Redis Cluster) where the client must reach the specific owner of a key: use the system’s own smart client and metadata, not a generic LB.',
  ],

  interview: [
    {
      q: 'Walk me through how a Maglev-style L4 load balancer keeps TCP connections alive when LB nodes or backends change.',
      a: 'Routers ECMP-hash flows across LB nodes that all announce the VIP over BGP. Each node maps the 5-tuple to a backend through a Maglev lookup table that is a deterministic function of the backend set, so any node picks the same backend for the same flow. Each node also keeps a local connection-tracking table so existing flows stick to their backend when the backend set changes. A flow only breaks if both an LB-node change and a backend change hit it at once. Backends reply directly to clients (DSR), so the LB carries only inbound bytes.',
      followUps: ['Why not plain modulo hashing?', 'What happens to conntrack state when an LB node dies?', 'How would you drain a backend in this design?', 'How does GitHub GLB avoid conntrack?'],
      seniorSignal: 'Explains the interplay of ECMP rehashing, deterministic consistent hashing and per-node conntrack, and why each one alone is insufficient.',
    },
    {
      q: 'Why does Envoy use power-of-two-choices instead of picking the least-loaded host?',
      a: 'Envoy has many workers and many proxies, each with only a partial, slightly stale view of load. Picking the global minimum makes all of them pile onto the same host at once (herding). P2C samples two random hosts and takes the less loaded one: the max load gap drops from about log n / log log n to about log log n, it is O(1), and randomness keeps balancers from synchronising. It also degrades gracefully when counters are stale.',
      followUps: ['What load signal would you use for P2C?', 'How does peak-EWMA improve on in-flight counts?', 'What happens with very few backends (n = 2 or 3)?'],
      seniorSignal: 'Brings up independent per-worker views and herding, not just "it is faster", and knows the asymptotic intuition.',
    },
    {
      q: 'Your health checks call the database. What can go wrong and how would you design them?',
      a: 'If the DB blips, every instance fails at once, the LB ejects the whole pool and a partial degradation becomes a full 503 outage. LB health checks should reflect whether this instance can serve (process up, not draining, local resources OK), while dependency health is handled with timeouts, circuit breakers and degraded responses. Add passive outlier detection with a max-ejection cap, and rely on fail-open or a panic threshold so a mass ejection spreads load instead of concentrating it.',
      followUps: ['What is Envoy’s panic threshold and why 50%?', 'Liveness vs readiness in Kubernetes?', 'How do you avoid flapping?'],
      seniorSignal: 'Recognises correlated failure through shared checks, and knows fail-open/panic behaviour as a deliberate design choice.',
    },
    {
      q: 'You scale a gRPC service from 10 to 30 pods and latency does not improve. Why, and what do you change?',
      a: 'gRPC multiplexes all RPCs over a few long-lived HTTP/2 connections; an L4 balancer (kube-proxy, NLB) assigns connections, not requests, so clients stay pinned to the original pods. Options: an L7 proxy or mesh that balances per stream, client-side balancing in gRPC (round_robin or xDS) over a headless service, and server-side MaxConnectionAge so connections periodically re-resolve and re-spread. I would also verify by looking at per-pod RPS skew.',
      followUps: ['What does a headless service change?', 'Cost of MaxConnectionAge on clients?', 'Would the same happen with WebSockets?'],
      seniorSignal: 'Identifies per-connection vs per-request balancing immediately and offers several fixes with trade-offs, plus how to verify.',
    },
    {
      q: 'How do you make the load balancer itself highly available?',
      a: 'Small scale: an active-passive pair with keepalived/VRRP moving a floating VIP in ~3 s, accepting idle capacity and split-brain risk. At scale: active-active nodes announcing the same anycast VIP via BGP with ECMP, consistent hashing so flows survive node changes, and BGP withdrawal on health failure. Managed LBs do this per AZ and publish node IPs in DNS. Above that, a GSLB layer handles region failure, and the data plane must keep serving with last-known config if the control plane is down.',
      followUps: ['What is split-brain in VRRP and how do you prevent it?', 'Why does ALB’s IP change and what breaks if clients pin it?', 'How fast is anycast failover?'],
      seniorSignal: 'Separates node, AZ and region failure domains and mentions control-plane/data-plane static stability.',
    },
    {
      q: 'Where would you terminate TLS, and what are the consequences?',
      a: 'Usually at the L7 edge LB, so it can route on HTTP, offload crypto and centralise certs, then re-encrypt or use mesh mTLS to backends for zero-trust and compliance. Passthrough (routing on SNI at L4) keeps end-to-end encryption and lets the backend own the key, but loses HTTP routing, retries and header injection. Share and rotate session-ticket keys across nodes so resumption works across an anycast fleet, and prefer ECDSA certificates to cut handshake CPU.',
      followUps: ['How does SNI routing work without decrypting?', 'What does TLS 1.3 0-RTT risk?', 'How do backends learn the client IP?'],
      seniorSignal: 'Weighs features vs trust boundary and knows the operational details: ticket keys, cert type, PROXY protocol.',
    },
    {
      q: 'Deploys cause a burst of 502s. How do you diagnose and fix it?',
      a: 'First split LB-generated from target-generated errors (ALB ELB_502 vs Target_5XX). If they are LB-generated during deploys, it is usually a race: the pod receives SIGTERM while LBs still route to it, or the deregistration delay is shorter than in-flight requests. Fix with a preStop sleep, graceful shutdown that stops accepting and finishes in-flight work, and a draining window sized to the longest request. If 502s also appear at idle times, check idle-timeout alignment between LB and backend.',
      followUps: ['Why does Kubernetes have this race at all?', 'How long should the deregistration delay be?', 'How do you drain WebSocket connections?'],
      seniorSignal: 'Starts from the metric that localises the error, and knows the endpoint-propagation race in Kubernetes.',
    },
  ],

  takeaways: [
    'Two tiers at scale: L4 (ECMP + Maglev hash + DSR) for packets, L7 proxies for HTTP features.',
    'P2C least-request beats strict least-conn when many balancers have partial, stale views.',
    'Health checks should reflect the instance, not shared dependencies; fail open rather than eject everyone.',
    'Draining, preStop sleeps and aligned idle timeouts eliminate most deploy-time and sporadic 502s.',
    'L4 balancing of HTTP/2 / gRPC is per connection; balance per request at L7 or client-side.',
    'Hash affinity is an optimisation; bound it (bounded-load hashing) and never make it the only copy of state.',
    'The LB itself needs HA (VRRP, anycast, managed multi-AZ) and a statically stable data plane.',
  ],
};

export default deep;
