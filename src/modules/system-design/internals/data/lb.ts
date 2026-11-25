import type { Internals } from '../types';

/** Exemplar entry — the quality bar for every other component. */
export const LB: Internals = {
  kind: 'lb',
  summary:
    'A load balancer is a reverse proxy that owns a pool of backends. It accepts the client connection, picks a healthy backend with a balancing algorithm, and forwards the bytes (L4) or the parsed HTTP request (L7). Health checks keep the pool honest; the LB itself is made redundant with a floating VIP or anycast.',
  parts: [
    { id: 'listener', name: 'Listener', role: 'Accepts connections on the VIP:port', detail: 'An `epoll`/`kqueue` event loop per CPU core accepts sockets (`SO_REUSEPORT` spreads accepts across workers). One worker can hold tens of thousands of idle connections.' },
    { id: 'tls', name: 'TLS terminator', role: 'Decrypts HTTPS once, at the edge', detail: 'Does the TLS handshake with the cert, keeps a **session-ticket cache** so returning clients skip the expensive part, then talks plain HTTP (or re-encrypted mTLS) to backends.' },
    { id: 'router', name: 'Router (L7 rules)', role: 'Matches host/path/header to a pool', detail: 'L7 only: parses HTTP and matches rules like `/api/* → api-pool`, `Host: img.* → image-pool`. L4 LBs skip this and route on IP:port alone.' },
    { id: 'algo', name: 'Balancer', role: 'Picks one backend from the pool', detail: 'Round-robin, weighted RR, **least connections**, **power of two choices** (sample 2, take the less loaded), or consistent hash on a key for affinity.' },
    { id: 'health', name: 'Health checker', role: 'Ejects dead backends from the pool', detail: 'Active checks (`GET /healthz` every 2–5 s, eject after N failures) plus passive outlier detection (eject a host returning 5xx). Ejected hosts are re-added after consecutive passes.' },
    { id: 'pool', name: 'Upstream pool', role: 'Keeps warm connections to backends', detail: 'Reuses keep-alive connections to each backend so every request doesn’t pay a TCP+TLS handshake; enforces per-host connection limits, timeouts and retries.' },
  ],
  flow: [
    { part: 'listener', title: 'Connection accepted', text: 'The client’s SYN reaches the VIP. A worker’s event loop accepts the socket without blocking any other connection.' },
    { part: 'tls', title: 'TLS terminated', text: 'The handshake happens here, once. Backends now see plain HTTP and spend their CPU on business logic, not crypto.' },
    { part: 'router', title: 'Route matched', text: '`GET /api/cart` matches the `/api/*` rule → **api pool**. An L4 LB would never see the path; it only knows the TCP 4-tuple.' },
    { part: 'health', title: 'Only healthy hosts are eligible', text: 'Backend 3 failed its last 3 `/healthz` probes, so it was ejected. The algorithm only sees backends 1, 2 and 4.' },
    { part: 'algo', title: 'Backend chosen', text: '**Least connections**: backend 2 has 4 in-flight vs 11 and 9 on the others, so it gets the request. Round-robin would have ignored that backend 1 is stuck on slow requests.' },
    { part: 'pool', title: 'Forwarded on a warm connection', text: 'An idle keep-alive connection to backend 2 is reused; the response streams back through the same path. On a timeout the LB may retry **once** on another host — only for idempotent requests.' },
  ],
  knobs: [
    {
      name: 'Layer',
      options: [
        { label: 'L4 (TCP/UDP)', effect: 'Forwards packets/streams by IP:port. Millions of conns, microseconds of overhead, protocol-agnostic.', when: 'Raw throughput, non-HTTP protocols (DBs, gRPC passthrough), in front of L7 LBs.' },
        { label: 'L7 (HTTP)', effect: 'Parses requests: path/header routing, retries, TLS termination, compression, auth hooks. More CPU per request.', when: 'Web/API traffic, canaries, path-based microservice routing.' },
      ],
    },
    {
      name: 'Algorithm',
      options: [
        { label: 'Round-robin', effect: 'Even request counts; blind to request cost and host speed.', when: 'Uniform, short requests on identical hosts.' },
        { label: 'Least connections', effect: 'Sends work to the least busy host; adapts to slow requests and slow hosts.', when: 'Variable request cost, long-lived connections (WebSockets).' },
        { label: 'Power of two choices', effect: 'Near-optimal balance at O(1) cost and no herding on stale load info.', when: 'Large pools, many LB instances with independent views (Envoy default for least-request).' },
        { label: 'Consistent hash (IP/key)', effect: 'Same key → same backend; only ~1/N keys move when the pool changes.', when: 'Cache-affinity or sticky routing; beware hot keys.' },
      ],
    },
    {
      name: 'Connection draining',
      options: [
        { label: 'Off', effect: 'Removing a host kills its in-flight requests → errors on every deploy.', when: 'Never in production.' },
        { label: 'On (e.g. 30 s)', effect: 'Stop sending new requests, let in-flight ones finish, then remove.', when: 'Rolling deploys and scale-in.' },
      ],
    },
  ],
  implementations: [
    { name: 'NGINX', how: 'One master + N worker processes, each a single-threaded `epoll` event loop; `upstream` blocks define pools with `least_conn`/`hash`. Config reload forks new workers and gracefully drains old ones.' },
    { name: 'HAProxy', how: 'Event-driven, multi-threaded since 1.8; very fast L4/L7 with rich health checks, stick tables (in-memory counters for rate limiting/affinity) and hitless reloads by passing listening sockets to the new process.' },
    { name: 'Envoy', how: 'C++ proxy with a thread per core, each owning its connections (no locks on the hot path). Config is pushed dynamically over the **xDS** APIs by a control plane — the basis of Istio/service meshes. Outlier detection and P2C least-request built in.' },
    { name: 'AWS ALB / NLB, Google Maglev', how: 'Managed fleets: NLB is L4 built on Hyperplane; Maglev uses ECMP from routers to many LB machines and a consistent-hash table so any LB machine sends a flow to the same backend.' },
  ],
  ha: 'The LB must not be the new SPOF. Run ≥2 instances: **active/passive with VRRP/keepalived** moving a floating VIP on failure, or **active/active** behind DNS / **anycast + ECMP** (routers spread flows over many LB nodes, as Maglev and Cloudflare do). Managed LBs do this for you across availability zones.',
  failureModes: [
    { name: 'LB is a SPOF', symptom: 'One LB box reboots → total outage.', fix: 'Pair with VRRP floating IP, or anycast/managed multi-AZ LB.' },
    { name: 'Retry storm', symptom: 'Backends slow down, LB retries every timeout, load doubles, everything melts.', fix: 'Retry budgets (≤10% extra), only for idempotent requests, with circuit breaking.' },
    { name: 'Health check lies', symptom: '`/healthz` returns 200 while the DB is down, so the LB keeps sending traffic to a broken host.', fix: 'Separate liveness from readiness; readiness checks critical deps (cheaply).' },
    { name: 'Uneven load from long connections', symptom: 'WebSocket/gRPC conns pinned to old hosts after scale-out.', fix: 'Least-conn, periodic connection recycling, L7 per-request balancing for HTTP/2.' },
  ],
  numbers: ['NGINX/HAProxy: ~10k–100k+ req/s per core for small requests', 'L4 adds ~µs; L7 adds ~0.1–1 ms', 'Health check every 2–5 s, eject after 3 fails ⇒ ~10 s to react'],
  interview: [
    { q: 'L4 vs L7 load balancer — when do you pick which?', a: 'L4 for raw throughput and non-HTTP protocols, since it never parses payloads. L7 when you need routing by path/header, TLS termination, retries or canaries. Large systems often stack them: L4 (anycast/ECMP) in front of an L7 tier.' },
    { q: 'Why is round-robin bad when requests have very different costs?', a: 'It balances request counts, not work. A host stuck on slow requests keeps receiving its share, queues grow and p99 explodes. Least-connections or power-of-two-choices react to actual in-flight load.' },
    { q: 'How do you avoid the load balancer being a single point of failure?', a: 'Run several LB instances: active/passive with a floating VIP via VRRP, or active/active behind DNS or anycast with ECMP. Keep the LB stateless (or share state) so any instance can take any flow.' },
  ],
  lab: 'lb',
};
