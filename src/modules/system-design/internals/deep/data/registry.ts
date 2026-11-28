import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'registry',

  // ───────────────────────── 1. Problem ─────────────────────────
  problem: {
    why:
      'In a fleet that autoscales, deploys 50 times a day and reschedules containers onto new hosts, an instance’s address is ephemeral: `orders` lives at 10.1.4.17:8080 for a few hours and then somewhere else. Service discovery turns a stable **name** into the **current set of healthy addresses**, and keeps that answer fresh as instances come, go and fail. The registry is the source of truth for that mapping; discovery is how callers read it.',
    withoutIt: [
      'Hard-coded IPs/hostnames in config: every scale-out or host replacement needs a config push and a restart of every caller.',
      'Dead instances keep receiving traffic because nothing tells callers they died — connection refused and timeouts until a human edits a file.',
      'New instances receive no traffic, so autoscaling adds cost but not capacity.',
      'Rolling deploys drop requests: nothing coordinates “stop sending to me” with “I am shutting down”.',
      'No locality: callers cannot prefer same-zone instances, so you pay cross-AZ latency and data-transfer charges on every hop.',
    ],
    position:
      'The registry is **control plane**: it is off the per-request path. Callers (a client library, a sidecar, kube-proxy rules or a DNS cache) hold a local copy of the endpoint list and pick an instance in microseconds; the registry only feeds that copy via heartbeats, health checks and watches.',
    diagram: {
      type: 'flow',
      title: 'Name → healthy addresses',
      nodes: [
        { label: 'Instance starts', sub: 'pod 10.1.4.17:8080', tone: 'neutral' },
        { label: 'Register', sub: 'self or orchestrator', tone: 'info' },
        { label: 'Registry catalog', sub: 'Raft / peer replicated', tone: 'violet' },
        { label: 'Health signal', sub: 'heartbeat, probe, gossip', tone: 'warn' },
        { label: 'Push / poll', sub: 'watch, xDS, DNS', tone: 'info' },
        { label: 'Caller cache', sub: 'picks instance locally', tone: 'ok' },
      ],
      caption: 'Writes flow left to right in the background; each request only touches the caller’s cache.',
    },
  },

  // ───────────────────────── 2. Architecture ─────────────────────────
  architecture: {
    overview:
      'Every registry has the same five jobs: accept registrations, decide liveness (heartbeats/leases, active health checks or gossip), store the catalog replicated across 3–5 servers, propagate changes (poll, long-poll, watch, xDS push, DNS), and let the caller choose an instance from a cached list. Products differ in **who** does each job (the instance, a node agent, the orchestrator) and in the **consistency** of the catalog (AP like Eureka vs CP like Consul, etcd, ZooKeeper).',
    diagram: {
      type: 'layers',
      title: 'Registry anatomy (top = caller side)',
      layers: [
        { name: 'Data plane (caller)', items: ['Client lib cache', 'Sidecar (Envoy)', 'kube-proxy rules', 'DNS cache'], tone: 'ok' },
        { name: 'Propagation', items: ['Delta poll', 'Blocking query', 'Watch stream', 'xDS push', 'DNS answer'], tone: 'info' },
        { name: 'Catalog (control plane)', items: ['Raft log / peer repl', 'name → endpoints', 'revision / index'], tone: 'violet' },
        { name: 'Liveness', items: ['Heartbeat / lease', 'Agent health checks', 'Gossip (SWIM)', 'k8s probes'], tone: 'warn' },
        { name: 'Registration', items: ['Self-register', 'Third-party registrar', 'Deregister on SIGTERM'], tone: 'neutral' },
      ],
      caption: 'The data plane must keep working on its cached copy when everything below it is down.',
    },
    blocks: [
      { name: 'Catalog', what: 'Map of service → instances (address, port, zone, metadata, health). Eureka keeps it in a `ConcurrentHashMap` of leases; Consul in a Raft-replicated MemDB; Kubernetes as `EndpointSlice` objects in etcd.' },
      { name: 'Lease / heartbeat', what: 'Liveness by renewal: Eureka renews every 30 s and expires after 90 s; etcd leases need `KeepAlive`; ZooKeeper sessions delete **ephemeral znodes** when they expire. Crash ⇒ silence ⇒ eventual removal.' },
      { name: 'Health checker', what: 'Liveness by probing: Consul agents run http/tcp/grpc/script/ttl checks next to the service; kubelet runs readiness probes; ALB target groups probe every 30 s by default. Detects “alive but broken”, which heartbeats miss.' },
      { name: 'Membership / failure detector', what: 'Consul’s Serf gossip (SWIM + Lifeguard) detects dead **nodes** in seconds without a central poller and marks every service on that node critical via the `serfHealth` check.' },
      { name: 'Change index', what: 'A monotonic version so readers can ask “what changed since X”: `X-Consul-Index`, etcd revision, Kubernetes `resourceVersion`, ZooKeeper zxid, Eureka delta + apps hashcode.' },
      { name: 'Propagation channel', what: 'How changes reach callers: polling (Eureka 30 s delta), long-poll (Consul blocking queries), watch streams (etcd, k8s), xDS gRPC push (Istio → Envoy), or DNS with TTL.' },
      { name: 'Caller-side cache + LB', what: 'The copy actually used per request: Ribbon/Spring Cloud LoadBalancer list, Envoy cluster membership, iptables/IPVS/nftables rules, a resolver cache. Holds last-known-good when the registry is unreachable.' },
    ],
    real: [
      { name: 'Netflix Eureka', how: 'REST registry, AP by design. Servers replicate registrations and heartbeats to peers asynchronously, with no consensus. Clients fetch the full registry then deltas every 30 s and balance locally (Ribbon, now Spring Cloud LoadBalancer). Self-preservation stops evictions when renewals collapse.' },
      { name: 'HashiCorp Consul', how: 'CP catalog on 3/5 servers via Raft; a client agent on every node runs health checks and joins the Serf LAN gossip pool; servers also join a WAN pool for multi-DC. HTTP API with blocking queries, DNS on port 8600, and Envoy xDS for Consul service mesh.' },
      { name: 'ZooKeeper (+ Curator)', how: 'CP via ZAB. Each instance creates an ephemeral znode under `/services/orders`; it disappears when the session times out. Callers `getChildren` with a watch. Curator’s `ServiceDiscovery`/`ServiceCache` wrap this; Airbnb’s SmartStack (Nerve + Synapse + local HAProxy) was built on it.' },
      { name: 'Kubernetes', how: 'Third-party registration: the EndpointSlice controller watches pods and writes ready addresses into `EndpointSlice` objects (etcd via kube-apiserver). kube-proxy turns them into iptables/IPVS/nftables rules behind a ClusterIP; CoreDNS serves names; headless Services return pod IPs.' },
      { name: 'Istio / Linkerd (mesh)', how: 'istiod watches Services and EndpointSlices and pushes EDS to every Envoy sidecar over an ADS gRPC stream; Envoy balances per request with outlier detection. Linkerd’s destination controller streams endpoints to its Rust proxies, which balance by latency (EWMA).' },
    ],
  },

  // ───────────────────────── 3. Lifecycle ─────────────────────────
  lifecycle: {
    summary:
      'One call from `cart` to `orders`. Discovery should add microseconds on the hot path: the lookup is a local cache hit, the instance pick is in-memory, and the connection is pooled. The expensive work (heartbeats, checks, deltas, watches) runs in background loops whose cost shows up as **staleness**, not latency.',
    stages: [
      { stage: 'Resolve name (cache hit)', what: 'Client library or sidecar already holds the `orders` endpoint list in memory (Eureka client cache, Envoy cluster, gRPC xDS resolver).', cost: 'Map lookup, µs', ms: 0.01, part: 'client-cache' },
      { stage: 'Resolve name (DNS path)', what: 'If discovery is DNS-based: stub resolver → NodeLocal DNSCache/CoreDNS. With ndots:5 an external name can cost several queries; a ClusterIP name returns one stable VIP.', cost: '~0.1 ms cached, ~1 ms CoreDNS', ms: 0.5, part: 'resolver' },
      { stage: 'Pick an instance', what: 'Round robin, least-request or power-of-two-choices over healthy, same-zone endpoints; outlier-ejected hosts skipped. In server-side mode kube-proxy’s DNAT does this per connection in the kernel.', cost: 'In-memory, µs', ms: 0.01, part: 'client-cache' },
      { stage: 'Sidecar hop (mesh only)', what: 'App → local Envoy over loopback; Envoy applies route, picks the endpoint from EDS, reuses an upstream mTLS connection.', cost: '~0.2–0.5 ms per proxy at p50', ms: 0.3, part: 'client-cache' },
      { stage: 'Connect', what: 'Pooled connection reused in steady state. A new connection costs a TCP handshake (intra-AZ ~0.1–0.5 ms) plus TLS 1.3 (1 RTT).', cost: '0 pooled, ~1 ms cold', ms: 0.2 },
      { stage: 'Stale endpoint → retry', what: 'If the picked instance died after the last refresh: connection refused is fast (~1 RTT); a blackholed host waits for the connect timeout. Retry on a different instance.', cost: '0 normally; 1 RTT or connect timeout', ms: 0 },
      { stage: 'Background: heartbeat / probe', what: 'Instance renews its lease (Eureka 30 s, etcd ~TTL/3) or the local agent/kubelet runs health checks (every 5–10 s).', cost: 'Off path; drives detection delay', ms: 0, part: 'heartbeat' },
      { stage: 'Background: refresh / watch', what: 'Client fetches a delta every 30 s (Eureka), holds a blocking query (Consul), or receives a watch/xDS push (k8s, Istio) within ~1 s of a change.', cost: 'Off path; drives staleness window', ms: 0, part: 'resolver' },
    ],
  },

  // ───────────────────────── 4. Deep dives ─────────────────────────
  deepDives: [
    {
      title: 'Four discovery patterns: client-side, server-side, DNS, mesh',
      hook: 'Where the instance choice happens decides your failure modes, language support and how fast traffic shifts.',
      body: [
        '**Client-side**: the caller fetches the registry, caches it and balances itself. Netflix’s Eureka client + Ribbon (now Spring Cloud LoadBalancer, cache TTL 35 s by default) and proxyless gRPC xDS work this way. No extra hop and per-request algorithms (least-request, zone affinity, retries on another host), but every language needs a correct library, and its caches add to staleness.',
        '**Server-side**: the caller hits a stable name/VIP and something else picks. In Kubernetes, a ClusterIP is a virtual IP that exists only as kube-proxy rules on every node. **iptables mode** walks `KUBE-SERVICES` sequentially (O(n) in Services) and picks an endpoint with `statistic --mode random` rules; **IPVS** uses kernel hash tables (O(1)) and real schedulers; **nftables** (GA in 1.33) uses verdict maps. On AWS, ALB target groups play the same role, with ECS or the AWS Load Balancer Controller registering targets.',
        'The kernel picks the backend on the **first packet** and conntrack pins the flow, so ClusterIP balances **connections, not requests**. **DNS-based** discovery returns addresses (A) or address+port+weight (SRV) and inherits every cache between you and the server. **Mesh sidecars** combine both models: istiod pushes EDS to Envoy, which balances per request locally, so the app stays dumb and the client-side behaviour is consistent across languages.',
      ],
      diagram: {
        type: 'compare',
        title: 'Who picks the instance?',
        columns: [
          { name: 'Client-side', tone: 'info', points: ['Lib caches registry', 'No extra hop', 'Per-request LB', 'Library per language', 'Eureka + Ribbon, gRPC xDS'] },
          { name: 'Server-side / DNS', tone: 'neutral', points: ['Call a VIP or name', 'kube-proxy, ALB, CoreDNS', 'Polyglot, zero code', 'L4: per connection', 'DNS caches add staleness'] },
          { name: 'Mesh sidecar', tone: 'violet', points: ['istiod pushes EDS', 'Envoy picks per request', 'Outlier detection, mTLS', '+0.2–0.5 ms per hop', 'Control plane to operate'] },
        ],
        caption: 'Mesh = client-side behaviour, server-side deployment model.',
      },
      table: {
        caption: 'kube-proxy data-plane modes',
        columns: ['Mode', 'Lookup', 'Rule update', 'Notes'],
        rows: [
          ['iptables', 'Sequential chains, O(n) Services', 'Rewrite via iptables-restore', 'Default; sync slows to minutes at ~10k+ Services'],
          ['IPVS', 'Kernel hash table, O(1)', 'Incremental', 'rr, lc, sh schedulers; still uses iptables for some paths'],
          ['nftables', 'Verdict maps, ~O(1)', 'Incremental transactions', 'GA in 1.33; the long-term replacement'],
          ['eBPF (Cilium)', 'BPF map lookup', 'Map update', 'Replaces kube-proxy; socket-level LB possible'],
        ],
      },
      insight:
        'gRPC/HTTP2 over a ClusterIP pins all requests of one long-lived connection to one pod. After a scale-out the new pods sit idle while old ones run hot. Use a headless Service with client-side balancing, a mesh, or server-side `MaxConnectionAge` to force periodic reconnects.',
    },
    {
      title: 'DNS-based discovery and its caching traps',
      hook: 'DNS is the universal discovery API, and every layer of it caches longer than you think.',
      body: [
        'DNS discovery answers `orders.service.consul` or `orders.default.svc.cluster.local` with A records (IPs only) or SRV records (target, port, priority, weight). Almost no HTTP client reads SRV, so in practice you get A records and a fixed port. In Kubernetes, a normal Service name resolves to one stable ClusterIP, so DNS staleness is harmless. A **headless** Service (`clusterIP: None`) returns pod IPs directly, which brings DNS staleness back.',
        'TTL is a request, not a guarantee. CoreDNS’s `kubernetes` plugin answers with TTL 5 s and the default Corefile adds `cache 30`. Consul DNS defaults to `service_ttl` 0 and `allow_stale = true`. Some resolvers and libraries clamp or ignore TTLs, and **negative answers are cached too**: an NXDOMAIN cached during a deploy can hide a brand-new service for the SOA negative TTL.',
        'The JVM caches positive lookups for `networkaddress.cache.ttl` (30 s by default without a security manager, **forever** with one, and in some older JDKs) and negative lookups for 10 s. The bigger trap sits above DNS: **connection pools never re-resolve**. A pooled keep-alive connection to an old IP lives until it errors, whatever the TTL says.',
      ],
      bullets: [
        'k8s `ndots:5`: `api.stripe.com` is tried against 3 search domains first, ×2 for A and AAAA. Use FQDNs with a trailing dot or lower ndots.',
        'UDP DNS answers are limited to 512 bytes without EDNS0. Large record sets get truncated (TC bit) and retried over TCP.',
        'gRPC’s `dns:///` resolver re-resolves when connections break, not on TTL, so new pods behind a headless Service may get no traffic.',
        'DNS has no load or health signal beyond what the server filters. Use it for coarse discovery, not for fast failover.',
      ],
      code: {
        lang: 'bash',
        caption: 'Pin JVM DNS caching explicitly (java.security or at startup)',
        code: `# $JAVA_HOME/conf/security/java.security  (or -Dsun.net.inetaddr.ttl=10 legacy flag)
networkaddress.cache.ttl=10
networkaddress.cache.negative.ttl=2

# What CoreDNS actually returns inside a pod
dig +noall +answer orders.default.svc.cluster.local      # ClusterIP, TTL 5
dig +noall +answer orders-headless.default.svc.cluster.local  # one A record per ready pod
dig @127.0.0.1 -p 8600 orders.service.consul SRV          # Consul: port + node`,
      },
      insight:
        'Fixing the TTL rarely fixes staleness, because the connection pool is the real cache. Bound connection lifetime (max-age/idle eviction) or use push-based discovery for sets that change every minute.',
    },
    {
      title: 'Eureka internals: AP registry, three caches, self-preservation',
      hook: 'Eureka deliberately serves possibly-wrong data rather than no data. You need to know exactly how wrong and for how long.',
      body: [
        'Each Eureka server holds the registry in memory as leases. Instances `POST` a registration and `PUT` a renewal every **30 s** (`lease-renewal-interval-in-seconds`); a lease not renewed for **90 s** (`lease-expiration-duration-in-seconds`) becomes eligible for eviction, and the evictor runs every **60 s**. A long-standing quirk in `Lease.renew()` adds the duration twice, so real expiry can approach 2× the configured value. Servers replicate every register/renew/cancel to peers asynchronously, with no quorum and no leader.',
        'Reads go through three layers on the server: registry → `readWriteCacheMap` (Guava, 180 s expiry) → `readOnlyCacheMap`, refreshed every **30 s**. Clients fetch `/apps/delta` every **30 s** and compare a hashcode of the whole registry; on mismatch they do a full fetch. Ribbon then refreshed its own server list every 30 s. Each layer adds up to 30 s of staleness, so a crashed instance can stay visible for ~3–4 minutes.',
        '**Self-preservation**: the server expects `instances × 2 × 0.85` renewals per minute (`renewal-percent-threshold`). If fewer arrive, it assumes **it** is partitioned rather than that 15%+ of the fleet died at once, and stops evicting. The dashboard shows “EMERGENCY! EUREKA MAY BE INCORRECTLY CLAIMING INSTANCES ARE UP WHEN THEY’RE NOT”. Even outside that mode, a single eviction run removes at most 15% of the registry.',
      ],
      code: {
        lang: 'yaml',
        caption: 'Spring Cloud Netflix defaults that define the staleness window',
        code: `eureka:
  instance:
    lease-renewal-interval-in-seconds: 30     # heartbeat
    lease-expiration-duration-in-seconds: 90  # lease TTL
  client:
    registry-fetch-interval-seconds: 30       # delta fetch
  server:
    eviction-interval-timer-in-ms: 60000      # evictor period
    use-read-only-response-cache: true
    response-cache-update-interval-ms: 30000  # readOnly cache refresh
    enable-self-preservation: true
    renewal-percent-threshold: 0.85
spring.cloud.loadbalancer.cache.ttl: 35s      # client LB cache`,
      },
      insight:
        'Self-preservation is the right call for the failure Netflix designed for (a registry partition), but the wrong one for mass deaths, such as a zone outage or a bad deploy that crash-loops. Then Eureka confidently serves corpses. Eureka only works if callers retry on a different instance and run outlier detection.',
    },
    {
      title: 'Consul internals: Raft catalog, gossip agents, blocking queries',
      hook: 'Consul splits failure detection (gossip, AP) from the catalog (Raft, CP). That split explains its behaviour under partition.',
      body: [
        '3 or 5 **servers** hold the catalog in Raft (quorum 2/3 or 3/5). A **client agent** runs on every node: it registers local services, runs their **health checks** (http, tcp, grpc, script, ttl, docker, alias) locally, and syncs results to the servers. Anti-entropy periodically diffs the agent’s local state against the catalog (at least every minute, slower in big clusters) and repairs drift in either direction.',
        'All agents join the **LAN gossip pool** (Serf on memberlist: SWIM plus HashiCorp’s **Lifeguard** extensions). Every second (probe interval 1 s, timeout 500 ms) each member pings a random peer, asks 3 others to ping indirectly on failure, then marks the peer **suspect** before declaring it dead. The suspicion timeout grows with log(N). A dead node’s `serfHealth` check goes critical, which takes all its services out of `?passing` results. Only servers join the **WAN pool**, which federates datacenters.',
        'Readers use **blocking queries**: pass the last `X-Consul-Index` and `wait=5m`, and the server holds the request until the index moves, adding up to wait/16 jitter so thousands of watchers don’t wake in lockstep. Read modes: **default** (leader serves, tiny staleness window on leader change), **consistent** (leader confirms leadership with a quorum first), **stale** (any server answers, check `X-Consul-LastContact`). DNS uses stale reads by default.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Node dies → service removed',
        actors: ['Node B agent', 'Node A agent', 'Peers', 'Servers (Raft)', 'Watcher'],
        messages: [
          { from: 'Node A agent', to: 'Node B agent', label: 'ping (1 s interval)', tone: 'neutral' },
          { from: 'Node A agent', to: 'Peers', label: 'no ack: ping-req ×3', tone: 'warn' },
          { from: 'Peers', to: 'Node A agent', label: 'no ack either', dashed: true, tone: 'warn' },
          { from: 'Node A agent', to: 'Peers', label: 'gossip: B suspect', tone: 'warn' },
          { from: 'Peers', to: 'Servers (Raft)', label: 'B dead after timeout', tone: 'bad' },
          { from: 'Servers (Raft)', to: 'Servers (Raft)', label: 'commit serfHealth critical', tone: 'violet' },
          { from: 'Servers (Raft)', to: 'Watcher', label: 'blocking query returns', tone: 'ok' },
        ],
        caption: 'Seconds to tens of seconds end to end, with no central poller hitting every node.',
      },
      code: {
        lang: 'bash',
        caption: 'Blocking-query watch loop (what consul-template and Envoy integrations do)',
        code: `idx=0
while true; do
  resp=$(curl -s -D hdr "http://127.0.0.1:8500/v1/health/service/orders?passing&index=$idx&wait=5m")
  new=$(grep -i X-Consul-Index hdr | tr -dc 0-9)
  [ "$new" -lt "$idx" ] && new=0          # index went backwards: reset
  [ "$new" != "$idx" ] && apply "$resp"   # only act when something changed
  idx=$new
done
# ?consistent = quorum-verified read; ?stale = any server (check X-Consul-LastContact)`,
      },
      insight:
        'Agents keep running health checks and serving their local cache when servers lose quorum, so the data plane survives. Writes and default-mode reads fail with “No cluster leader”. Run `allow_stale` DNS and agent caching, or a short leader election becomes a discovery outage.',
    },
    {
      title: 'ZooKeeper & etcd as registries: sessions, leases, watches',
      hook: 'If you build discovery on a consensus store, its liveness primitive and watch semantics are your discovery semantics.',
      body: [
        '**ZooKeeper**: each instance creates an **ephemeral znode** `/services/orders/<id>` bound to its session. The client library heartbeats; if the server hears nothing for the session timeout (negotiated within 2–20× `tickTime`, so 4–40 s at the 2 s default, typically set to 6–30 s), the ensemble expires the session and deletes the znode. Callers `getChildren(path, watch=true)`. Classic watches are **one-shot**: after it fires you must re-read and re-arm, and changes in between are folded into that read. ZooKeeper 3.6 added persistent watches.',
        '**Herd effect**: 10,000 callers watching `/services/orders` all fire on every change and all issue `getChildren` at once, so each deploy step costs 10k reads. Curator’s `ServiceCache` caches locally but still re-reads. **etcd** replaces sessions with **leases**: `Grant(ttl)`, attach keys, and `KeepAlive` renews about every TTL/3. Watches are streams that resume from a **revision**, so nothing is missed unless that revision was compacted.',
        'When the requested revision was compacted, the watch fails with `ErrCompacted` and the client must re-list everything. Kubernetes hits the same edge: kube-apiserver compacts etcd every 5 minutes, and clients that fall behind get **410 Gone** (“too old resource version”) and re-list. That re-list is a classic load spike on the API server.',
      ],
      code: {
        lang: 'go',
        caption: 'etcd: register with a lease, discover with list + watch-from-revision',
        code: `lease, _ := cli.Grant(ctx, 10)                     // 10 s TTL
cli.Put(ctx, "/services/orders/10.1.4.17:8080", meta, clientv3.WithLease(lease.ID))
keep, _ := cli.KeepAlive(ctx, lease.ID)            // renews ~every TTL/3
go func() { for range keep {} }()                  // drain acks

resp, _ := cli.Get(ctx, "/services/orders/", clientv3.WithPrefix())
snapshot := load(resp.Kvs)                          // initial list
w := cli.Watch(ctx, "/services/orders/", clientv3.WithPrefix(),
    clientv3.WithRev(resp.Header.Revision+1))      // no gap between list and watch
for wr := range w {
    if wr.Err() != nil { snapshot = relist() ; continue } // ErrCompacted etc.
    for _, ev := range wr.Events { snapshot.apply(ev) }  // DELETE = lease expired
}`,
      },
      insight:
        'Session/lease timeout is a direct tradeoff: shorter detects crashes faster, but a 10 s GC pause or network blip on a healthy instance now deletes it from discovery, and it re-registers seconds later. That flapping churns every watcher. Size the TTL to your worst pause, not your average.',
    },
    {
      title: 'Kubernetes: EndpointSlices, probes and kube-proxy',
      hook: 'Kubernetes is a third-party registrar whose correctness depends on probes you configure and on propagation you don’t control.',
      body: [
        'Pods don’t register themselves. The **EndpointSlice controller** watches Pods and Services and writes each matching pod’s IP with conditions `ready`, `serving` and `terminating` into `EndpointSlice` objects of at most **100 endpoints** each (`--max-endpoints-per-slice`). The legacy `Endpoints` object put every address in one object, is now truncated at 1,000 addresses, and had to be resent in full to every watcher on any change.',
        'Readiness is the registry’s health signal. A **readiness** failure removes the pod from Service endpoints without restarting it. A **liveness** failure makes kubelet restart the container. A **startup** probe holds the other two off until slow boots finish. Defaults are `periodSeconds: 10`, `failureThreshold: 3`, `timeoutSeconds: 1`, so detecting “not ready” takes ~30 s unless you tune it.',
        'kube-proxy on **every node** watches EndpointSlices and reprograms iptables/IPVS/nftables, rate-limited by `--iptables-min-sync-period` (1 s). CoreDNS, ingress controllers, the AWS Load Balancer Controller and istiod each run their own watches, so every consumer converges at a different moment.',
      ],
      bullets: [
        '`publishNotReadyAddresses: true` publishes pods before they are ready. StatefulSets use it so peers can find each other during bootstrap (etcd, Cassandra seeds).',
        'Headless Service (`clusterIP: None`) means no VIP: DNS returns ready pod IPs, and callers balance themselves.',
        'Terminating endpoints stay in the slice with `ready=false, terminating=true`. kube-proxy can still fall back to `serving` terminating pods when no ready ones exist (GA in 1.28).',
        'Topology: `spec.trafficDistribution: PreferClose` (older: `service.kubernetes.io/topology-mode: Auto` hints) keeps traffic in-zone when endpoints are spread evenly.',
        'Liveness probes that check dependencies (DB) cause cascading restarts. Keep liveness shallow and readiness meaningful.',
      ],
      diagram: {
        type: 'flow',
        title: 'Pod readiness → traffic',
        nodes: [
          { label: 'kubelet probe', sub: 'every 10 s ×3', tone: 'warn' },
          { label: 'Pod status', sub: 'Ready=False via API', tone: 'neutral' },
          { label: 'EndpointSlice ctrl', sub: 'ready=false', tone: 'violet' },
          { label: 'etcd / watch', sub: 'fan-out to N nodes', tone: 'info' },
          { label: 'kube-proxy', sub: 'rules resync ≥1 s', tone: 'info' },
          { label: 'No new conns', sub: 'existing ones continue', tone: 'ok' },
        ],
        caption: 'Removing an endpoint stops new connections only. Established ones live until closed.',
      },
      insight:
        'Removing an endpoint does not close connections. Keep-alive and HTTP/2 clients keep talking to a not-ready pod over existing conntrack flows. The pod must still serve (or send `Connection: close` / GOAWAY) for a while after it leaves the endpoints.',
    },
    {
      title: 'Instance dies: when does traffic actually stop?',
      hook: 'The staleness window is the sum of every timer and cache between the failure and the caller. Senior answers add them up.',
      body: [
        'Separate **graceful** exits (the instance deregisters itself, or the orchestrator marks it terminating) from **crashes** (silence, so you wait for a timeout). Graceful removal is bounded by propagation and cache layers. Crash removal adds detection time on top. In every system the caller’s last line of defence is the same: fail fast (connection refused is one RTT; a blackholed host costs a connect timeout), **retry on another instance**, and eject outliers.',
        'Kubernetes adds a race on graceful shutdown. Deleting a pod **concurrently** triggers preStop/SIGTERM in the kubelet and removal from EndpointSlices. If the app exits on SIGTERM before every kube-proxy, ingress and load balancer has caught up, in-flight and new requests hit a closed socket and you see 502/503 bursts on every rollout. The fix is a preStop sleep that outlasts propagation, then graceful draining.',
      ],
      table: {
        caption: 'Worst-case time until callers stop picking a dead instance (defaults)',
        columns: ['System', 'Detect (crash)', 'Propagate', 'Caller caches', 'Typical worst case'],
        rows: [
          ['Eureka', '90 s lease (up to 2× quirk) + 60 s evictor', 'Server readOnly cache 30 s', 'Client fetch 30 s + Ribbon 30 s', '~3–4 min (graceful cancel: ~1–1.5 min)'],
          ['Consul', 'Gossip ~5–15 s (node) or check interval × failures', 'Raft commit ms; blocking query returns', 'consul-template / DNS TTL (0 default)', 'Seconds to ~30 s'],
          ['Kubernetes', 'Readiness 10 s × 3 = 30 s; node loss: 40 s grace + eviction', 'Slice update + watch ~1 s', 'kube-proxy sync ≥1 s; conntrack pins flows', '~30–35 s (graceful: ~1–2 s)'],
          ['ZooKeeper / etcd', 'Session / lease TTL (6–30 s)', 'Watch fires immediately', 'Client re-read', 'TTL + ~1 s'],
          ['DNS + JVM', 'Whatever feeds the zone', 'Record TTL', 'JVM 30 s or forever; pooled conns', 'TTL to forever'],
          ['Envoy outlier detection', '5 consecutive 5xx / gateway errors', 'Local, per proxy', 'Ejected for 30 s × n', '< 1 s under load'],
        ],
      },
      diagram: {
        type: 'sequence',
        title: 'k8s pod deletion race (and the fix)',
        actors: ['API server', 'kubelet', 'Pod', 'EndpointSlice ctrl', 'kube-proxy (all nodes)'],
        messages: [
          { from: 'API server', to: 'kubelet', label: 'deletionTimestamp set', tone: 'neutral' },
          { from: 'API server', to: 'EndpointSlice ctrl', label: 'pod terminating', tone: 'neutral' },
          { from: 'kubelet', to: 'Pod', label: 'preStop: sleep 10', tone: 'ok' },
          { from: 'EndpointSlice ctrl', to: 'kube-proxy (all nodes)', label: 'ready=false (~1–2 s)', tone: 'info' },
          { from: 'kube-proxy (all nodes)', to: 'Pod', label: 'no new connections', dashed: true, tone: 'info' },
          { from: 'kubelet', to: 'Pod', label: 'SIGTERM after sleep', tone: 'warn' },
          { from: 'Pod', to: 'Pod', label: 'drain in-flight, exit', tone: 'ok' },
        ],
        caption: 'Without the preStop sleep, SIGTERM races the endpoint removal and in-flight calls fail.',
      },
      code: {
        lang: 'yaml',
        caption: 'Rolling-deploy safe pod spec',
        code: `spec:
  terminationGracePeriodSeconds: 45     # > preStop + drain time
  containers:
  - name: orders
    lifecycle:
      preStop:
        sleep: { seconds: 10 }          # k8s 1.30+; older: exec ["sleep","10"]
    readinessProbe:
      httpGet: { path: /ready, port: 8080 }
      periodSeconds: 5
      failureThreshold: 2               # ~10 s to pull a sick pod
# app: on SIGTERM stop accepting, finish in-flight, close keep-alives, exit
# behind an AWS ALB: preStop must also cover target deregistration (default delay 300 s)`,
      },
      insight:
        'You cannot make detection instantaneous, so design for a non-zero window: idempotent requests, retries to a **different** host with a retry budget, outlier ejection, and tight connect timeouts (~100–250 ms intra-DC). These shrink the impact of staleness more than shaving heartbeat intervals does.',
    },
    {
      title: 'AP vs CP under partition: Eureka vs Consul',
      hook: 'The registry’s CAP choice decides who gets wrong answers during a partition, and whether anyone gets an answer at all.',
      body: [
        'Scenario: 3 AZs, one registry server per AZ, and AZ-c is cut off. **Eureka (AP)**: every server keeps answering. The AZ-c server stops getting renewals from AZ-a/b instances, crosses the 85% threshold and enters self-preservation, so it keeps listing them. Callers in AZ-c pick unreachable instances and must retry. Instances in AZ-c can still register, but only locally. When the partition heals, heartbeats to peers that don’t know an instance return 404 and trigger re-registration, so the views converge.',
        '**Consul (CP catalog)**: the AZ-c server loses the leader. Writes and default/consistent reads there fail (“No cluster leader”), and only `stale` reads and agent caches keep answering with frozen data. On the majority side, gossip declares AZ-c nodes dead, their services turn critical and traffic shifts to a/b. That is correct if AZ-c is really gone, and it is a self-inflicted capacity loss if only the cross-AZ link broke. **ZooKeeper** behaves similarly: minority clients lose their sessions and the majority deletes their ephemeral znodes.',
        'Netflix chose AP because, for discovery, a stale list plus client retries beats having no list during the exact moments (partitions, AZ failures) when discovery matters most. Knewton’s 2014 post “Eureka! Why You Shouldn’t Use ZooKeeper for Service Discovery” made the same argument. The counter-argument is that a CP registry with **AP caches at the edge** gives one authoritative truth plus survivability, which is what Consul, Kubernetes and Istio do in practice.',
      ],
      diagram: {
        type: 'compare',
        title: 'Partition: AZ-c isolated',
        columns: [
          { name: 'Eureka (AP)', tone: 'warn', points: ['All servers keep answering', 'Self-preservation: no evictions', 'AZ-c sees unreachable a/b', 'Views diverge, reconcile later', 'Callers must retry'] },
          { name: 'Consul (CP catalog)', tone: 'info', points: ['Minority loses leader', 'Writes fail on minority', 'stale reads + agent cache work', 'Majority marks c nodes dead', 'Traffic shifts to a/b'] },
        ],
        caption: 'Neither is “correct”. Choose which wrong answer your callers can tolerate.',
      },
      insight:
        'For discovery, the core can be CP but the edges must be AP: every client or sidecar keeps last-known-good, never empties its pool because the registry returned nothing, and treats the registry’s answers as hints that its own health checks and outlier detection can override (Envoy’s panic threshold, at 50% healthy by default, does exactly this).',
    },
  ],

  // ───────────────────────── 5. Scaling & HA ─────────────────────────
  scaling: {
    body: [
      'Treat the registry as **control plane**: its outage must freeze discovery (no new instances, no removals), not break traffic. That means every consumer caches last-known-good, starts from a persisted snapshot if possible, and keeps serving cached endpoints when watches fail. Consul: 3 servers tolerate 1 failure, 5 tolerate 2; more servers add write latency, not read capacity (scale reads with stale reads, agent caching or non-voting read replicas in Enterprise).',
      'The scaling bottleneck is **fan-out, not storage**. A catalog of 50k instances is a few MB. The cost is N watchers × change rate × payload size. Kubernetes moved from Endpoints to EndpointSlices for this reason. Istio scopes pushes with the `Sidecar` resource and debounces changes (`PILOT_DEBOUNCE_AFTER` 100 ms), and delta xDS sends only changed endpoints. Eureka clients fetch deltas plus a hashcode check instead of the full registry.',
      'Multi-DC: **Consul** runs one Raft cluster per datacenter and federates over the WAN gossip pool; cross-DC queries are forwarded (`orders.service.dc2.consul`) and prepared queries can fail over to the nearest DC. **Eureka** runs per-region clusters with zone affinity inside. **Kubernetes** stays per-cluster; multi-cluster discovery comes from a mesh (Istio multi-primary), Cilium ClusterMesh or the MCS API. Avoid one global registry: it couples the blast radius of every region.',
    ],
    bullets: [
      'Thundering herd: 10k clients re-fetching on every change. Mitigate with deltas, jittered polls or blocking-query jitter (Consul adds up to wait/16), coalescing at a sidecar or node agent, and debounced pushes.',
      'Watch-cache layering: kube-apiserver serves watches from an in-memory watch cache, not etcd. A re-list storm after a compaction gap (410 Gone) still hits it hard.',
      'Zone-aware routing: Eureka `prefer-same-zone`, k8s `trafficDistribution: PreferClose`, Envoy locality-weighted / zone-aware LB. Keep capacity balanced per zone or the local zone overloads.',
      'Registration storms after a registry restart: thousands of instances re-register at once. Use jittered backoff on re-registration and rate-limit at the server.',
      'Keep discovery lookups off the hot path. A per-request call to the registry turns a control plane into a data plane with the registry’s availability.',
      'Separate registry clusters per blast-radius domain (region, environment, criticality tier) instead of one giant cluster.',
      'Monitor freshness, not just uptime: age of the last successful sync on clients/sidecars and xDS push latency (`pilot_proxy_convergence_time`).',
    ],
    diagram: {
      type: 'layers',
      title: 'Control plane vs data plane',
      layers: [
        { name: 'Data plane: must survive alone', items: ['Envoy EDS cache', 'Client LB cache', 'kube-proxy rules', 'Last-known-good'], tone: 'ok' },
        { name: 'Fan-out tier', items: ['Delta xDS', 'Watch cache', 'Agent / sidecar coalescing', 'Jitter + debounce'], tone: 'info' },
        { name: 'Control plane (quorum)', items: ['3–5 Raft voters', 'Per-DC cluster', 'WAN federation'], tone: 'violet' },
      ],
      caption: 'Scale the middle tier for fan-out; keep the quorum small for write latency.',
    },
  },

  // ───────────────────────── 6. Failures ─────────────────────────
  failures: [
    {
      name: 'Stale endpoints after deploy / scale-in',
      symptom: 'Burst of connection refused, 502/503 or connect timeouts on every rollout or scale-in, lasting seconds (k8s) to minutes (Eureka).',
      detect: 'Callers’ `upstream_cx_connect_fail` / `envoy_cluster_upstream_rq_503`, ingress 502 rate annotated with deploy events, client `ConnectException` counters per target IP.',
      mitigate: 'preStop sleep + graceful drain, deregister before shutdown, retries to a different host with a budget, outlier detection, short connect timeouts.',
    },
    {
      name: 'Registry outage / quorum loss',
      symptom: 'New instances get no traffic, dead ones are never removed; apps that resolve per request or start with an empty cache fail outright.',
      detect: '`consul.raft.state.candidate` rising, “No cluster leader” errors, client sync-age gauge, Eureka client `lastSuccessfulRegistryFetchTimePeriod`.',
      mitigate: 'Last-known-good caches (persist to disk for cold starts), 3/5 servers across AZs, don’t block startup on the registry, freeze deploys until quorum returns.',
    },
    {
      name: 'Self-preservation serving dead instances',
      symptom: 'After a zone failure or crash-looping deploy, Eureka keeps advertising dead instances indefinitely; error rates stay high long after the cause is fixed.',
      detect: 'Eureka dashboard EMERGENCY banner, `isBelowRenewThreshold` = 1, renewals/min vs threshold gauge diverging.',
      mitigate: 'Client retries + outlier ejection; graceful `cancel` on shutdown; tune threshold for small fleets (where one instance is >15%); alert on sustained self-preservation.',
    },
    {
      name: 'Watch storm / thundering herd',
      symptom: 'Every deploy spikes registry/API server CPU and latency; sidecars and clients fall behind and see larger staleness.',
      detect: 'kube-apiserver `apiserver_watch_events_total`, 410/relist rate, ZooKeeper `watch_count` and outstanding requests, istiod `pilot_xds_pushes` and push time.',
      mitigate: 'EndpointSlices / delta xDS, Istio `Sidecar` scoping, jitter and debounce, node-local agents that coalesce watches, fewer broad-prefix watchers.',
    },
    {
      name: 'DNS caching forever / pinned connections',
      symptom: 'After a failover or LB IP change, some JVM services keep calling the old IP for hours while others recovered.',
      detect: 'Per-destination-IP error rate, connections to decommissioned IPs in conntrack/VPC flow logs, JVM `networkaddress.cache.ttl` audit.',
      mitigate: 'Explicit JVM TTL (5–60 s), bounded connection max-age, push-based discovery for volatile sets, stable VIPs in front of churny backends.',
    },
    {
      name: 'Raft leader flapping',
      symptom: 'Intermittent registry write failures and slow blocking queries; repeated elections under load or disk stalls.',
      detect: '`consul.raft.leader.lastContact` p99 approaching the lease timeout, `consul.raft.state.leader` increments, etcd `etcd_server_leader_changes_seen_total`, WAL `fsync` p99.',
      mitigate: 'Dedicated SSDs, isolate servers from noisy neighbours, `raft_multiplier = 1` on good hardware, reduce write load (KV abuse, check output churn).',
    },
    {
      name: 'Split view / divergent registries',
      symptom: 'Different callers see different instance sets (Eureka peers out of sync, two k8s clusters with overlapping names); traffic skews or loops.',
      detect: 'Compare instance counts per service across registry nodes/regions; Eureka “unavailable-replicas” on the dashboard; per-instance traffic share outliers.',
      mitigate: 'Accept and bound it (AP) with retries, or use a CP catalog; health-check from the caller side; reconcile on heal; one registry authority per name.',
    },
  ],
  warStories: [
    {
      title: 'Roblox: 73-hour outage rooted in Consul',
      source: 'Roblox public postmortem, Oct 28–31 2021',
      what:
        'Roblox ran service discovery, Vault and Nomad on a single critical Consul cluster. Under unusually high load, Consul performance collapsed: the newly enabled **streaming** feature caused contention under heavy read/write load, and a pathological **BoltDB freelist** behaviour in the Raft log store degraded writes. Because almost everything (including their own tooling and monitoring) depended on Consul, recovery took 73 hours.',
      lesson:
        'Discovery is a tier-0 dependency. Bound its blast radius (multiple clusters), keep data planes working on cached state, and keep observability and recovery tooling independent of the thing they observe.',
    },
    {
      title: 'Every rollout drops ~0.5% of requests',
      source: 'Composite of common incidents',
      what:
        'A team moved to Kubernetes and saw 502 bursts from the ingress during each deploy. Pods exited immediately on SIGTERM while ingress-nginx and remote kube-proxies still routed to them for 1–3 s; keep-alive connections from the ingress hit closed sockets.',
      lesson:
        'Pod deletion and endpoint removal are concurrent. Add a preStop sleep longer than propagation, drain in-flight requests, and have the ingress retry idempotent requests on another upstream.',
    },
    {
      title: 'Eureka kept dead instances after an AZ incident',
      source: 'Composite of common incidents',
      what:
        'A network event dropped renewals from one AZ below the 85% threshold and Eureka entered self-preservation. The AZ’s instances were then really terminated by the ASG, but Eureka kept advertising them for over an hour; callers without retry-on-next-server saw elevated errors.',
      lesson:
        'An AP registry hands correctness to the client: retries to another instance, outlier detection and graceful deregistration are mandatory, and sustained self-preservation needs an alert.',
    },
    {
      title: 'JVM fleet pinned to a decommissioned IP',
      source: 'Composite of common incidents',
      what:
        'A database proxy behind DNS failed over to new IPs. Most services recovered within the TTL, but a set of older JVM services ran with a security manager (DNS cached forever) and long-lived pools, and kept hammering the old address until restarted.',
      lesson:
        'DNS TTL is advisory. Set JVM caching explicitly, cap connection lifetime, and test failover with the real client stack, not `dig`.',
    },
  ],

  // ───────────────────────── 7. Numbers ─────────────────────────
  numbers: [
    { label: 'Eureka heartbeat / lease expiry', value: '30 s / 90 s', note: 'Evictor every 60 s; real expiry can approach 2× because of the `Lease.renew()` quirk.' },
    { label: 'Eureka caching layers', value: '30 s + 30 s + 30 s', note: 'Server readOnly cache, client delta fetch, Ribbon list ⇒ ~3–4 min crash staleness.' },
    { label: 'Eureka self-preservation threshold', value: '85% of expected renewals', note: 'Expected = instances × 2 per minute; evictions stop below it.' },
    { label: 'Consul LAN gossip', value: 'probe 1 s, timeout 500 ms', note: '3 indirect probes; suspicion ≈ 4 × log10(N) × 1 s ≈ 12 s at 1,000 nodes.' },
    { label: 'Consul / etcd quorum', value: '3 → tolerates 1, 5 → 2', note: 'More voters = slower writes, not more read capacity.' },
    { label: 'etcd Raft timers', value: '100 ms heartbeat, 1,000 ms election', note: 'Consul: 1 s base timers × `raft_multiplier` (default 5).' },
    { label: 'ZooKeeper session timeout', value: '6–30 s typical', note: 'Bounded to 2–20 × tickTime (2 s default ⇒ 4–40 s).' },
    { label: 'EndpointSlice size', value: '100 endpoints / slice', note: 'Legacy Endpoints truncated at 1,000 addresses.' },
    { label: 'k8s readiness defaults', value: '10 s × 3 failures', note: '~30 s to mark not-ready; endpoint propagation adds ~1–2 s.' },
    { label: 'CoreDNS defaults', value: 'TTL 5 s, cache 30 s', note: '`kubernetes` plugin TTL plus Corefile `cache 30`.' },
    { label: 'JVM DNS cache', value: '30 s (forever with SecurityManager)', note: 'Negative answers cached 10 s.' },
    { label: 'AWS ALB target group', value: '30 s checks, 300 s dereg delay', note: 'Unhealthy after 2 failures by default.' },
  ],
  capacity: {
    question:
      'A Kubernetes Service has 5,000 pods on a 3,000-node cluster. Estimate control-plane fan-out for one rolling update with legacy Endpoints vs EndpointSlices.',
    steps: [
      'Legacy Endpoints: one object with 5,000 addresses ≈ 300 B each ≈ 1.5 MB, which is near etcd’s default request limit.',
      'Every change resends the whole object to every watcher: kube-proxy on 3,000 nodes ⇒ 1.5 MB × 3,000 = 4.5 GB per change.',
      'A rolling update changes each pod at least once ⇒ 5,000 × 4.5 GB ≈ 22 TB pushed by the API servers (more counting not-ready → removed → added).',
      'EndpointSlices: 50 slices of 100 endpoints ≈ 30 KB each; a change rewrites one slice ⇒ 30 KB × 3,000 = 90 MB per change.',
      '5,000 changes × 90 MB ≈ 450 GB, about 50× less, and each kube-proxy only re-processes one small slice.',
    ],
    answer:
      '~22 TB vs ~450 GB per rollout. Discovery scaling is about watch fan-out × object size × change rate, which is why EndpointSlices, delta xDS and sidecar scoping exist.',
  },

  // ───────────────────────── 8. Comparison ─────────────────────────
  comparison: {
    caption: 'Service discovery systems',
    columns: ['Product', 'Consistency (CAP)', 'Health checking', 'Membership / failure detection', 'Client integration', 'Best for'],
    rows: [
      ['Netflix Eureka', 'AP: async peer replication, self-preservation', 'Client heartbeats (30 s); optional health URL', 'Lease expiry 90 s + evictor', 'Java client lib (Spring Cloud) + client-side LB', 'JVM/Spring fleets on VMs that prefer stale over unavailable'],
      ['HashiCorp Consul', 'CP catalog (Raft); stale reads optional', 'Local agent checks: http/tcp/grpc/script/ttl', 'Serf gossip (SWIM + Lifeguard), seconds', 'DNS, HTTP blocking queries, Envoy xDS', 'Multi-platform / multi-DC (VMs + k8s + Nomad)'],
      ['ZooKeeper (+ Curator)', 'CP (ZAB)', 'None built-in: liveness = session', 'Ephemeral znodes, session timeout', 'Thick client, one-shot watches', 'Teams already running ZK (Kafka-era, Hadoop)'],
      ['etcd', 'CP (Raft), linearizable reads', 'None built-in: liveness = lease', 'Lease TTL + KeepAlive', 'gRPC watch from revision', 'Building blocks for platforms (k8s itself)'],
      ['Kubernetes Service + DNS', 'CP source (etcd), eventually consistent fan-out', 'kubelet readiness/liveness/startup probes', 'Node heartbeats (Lease objects) + controllers', 'Zero code: ClusterIP VIP, CoreDNS', 'Anything running inside one k8s cluster'],
      ['Istio / Envoy EDS', 'Derived from k8s (or ServiceEntry); push', 'k8s readiness + Envoy outlier detection', 'Inherits k8s; passive ejection', 'Sidecar or proxyless gRPC xDS', 'Large polyglot fleets needing per-request LB, mTLS'],
    ],
  },
  whenNot: [
    'A monolith or a handful of stable services: a load balancer with a DNS name (ALB, nginx upstream) is enough. A registry is one more tier-0 system to run.',
    'Inside Kubernetes, don’t layer Eureka or Consul on top of Services without a concrete need (VM interop, multi-platform). Two registries disagree, and you debug both.',
    'Don’t build a registry on ZooKeeper/etcd from scratch unless you already operate one. Use Consul or the platform’s discovery instead of re-implementing sessions, watches and caching.',
    'For third-party or public endpoints (Stripe, S3), use plain DNS + their LB. Discovery is for addresses you control and that churn.',
    'Never put a registry lookup on the per-request path. If you can’t cache, you have built a dependency with the registry’s availability, not a discovery system.',
  ],

  // ───────────────────────── 9. Interview ─────────────────────────
  interview: [
    {
      q: 'Should a service registry be AP or CP? Defend your choice.',
      a: 'The catalog can reasonably be either, but the edges must be AP. A CP core (Consul, etcd) gives one authoritative view and safe writes, but a minority partition can’t register or read consistently. An AP core (Eureka) always answers but may list dead instances and miss new ones. In both cases the data plane must cache last-known-good, never empty a pool on an empty answer, and correct with retries and outlier detection. I would pick a CP catalog with stale-read/agent caching for most fleets, and AP only if registry availability during partitions dominates and every client has robust retries.',
      followUps: [
        'What exactly does a caller in the minority partition see with Consul vs Eureka?',
        'How would you prevent a CP registry’s leader election from becoming an outage?',
        'When does self-preservation make things worse?',
      ],
      seniorSignal: 'Separates catalog consistency from data-plane availability and names concrete behaviour under partition (stale reads, self-preservation, ephemeral-node deletion) instead of reciting CAP.',
    },
    {
      q: 'An instance crashes. How long do clients keep sending it traffic, and how do you shrink that?',
      a: 'Add up detection + propagation + every cache. Eureka defaults: up to 90 s lease (longer with the renew quirk) + 60 s evictor + 30 s server response cache + 30 s client fetch + 30 s Ribbon, so ~3–4 minutes. Kubernetes: readiness 3 × 10 s, plus ~1–2 s for EndpointSlice and kube-proxy sync, though a node crash goes through node-lease timeout (~40 s) and eviction instead. Consul gossip detects a dead node in seconds. To shrink it, tune probes and leases, push instead of poll, and remove cache layers. The bigger win is on the caller: fast connect timeouts, retry on a different host, and passive outlier ejection, which reacts in under a second.',
      followUps: [
        'Why not set the Eureka heartbeat to 1 s?',
        'What is different when the host is blackholed rather than refusing connections?',
        'How does the answer change for a graceful shutdown?',
      ],
      seniorSignal: 'Produces an actual timeline with named timers and distinguishes crash from graceful exit, then points at caller-side mitigations rather than only tuning intervals.',
    },
    {
      q: 'Client-side vs server-side discovery for 2,000 services in 6 languages?',
      a: 'Client-side libraries give per-request balancing with no extra hop, but at 2,000 services in 6 languages you get 6 libraries with different bugs, retry semantics and cache behaviour, and fleet-wide upgrades take quarters. Server-side via kube-proxy is zero code but L4: it balances connections, has no retries or outlier ejection, and pins HTTP/2. I would use a mesh (Envoy sidecars or proxyless gRPC xDS) so behaviour is uniform and centrally configured, and scope config with `Sidecar` resources and delta xDS so each proxy only learns the ~20–50 services it calls.',
      followUps: [
        'What does the control plane push look like without scoping at 2,000 services × 20k pods?',
        'When would you choose proxyless gRPC over sidecars?',
        'What is the cost of the sidecar hop in latency and memory?',
      ],
      seniorSignal: 'Reasons about organisational cost (library sprawl) and control-plane fan-out, not just hop count.',
    },
    {
      q: 'Why do rolling deploys on Kubernetes drop requests, and how do you fix it?',
      a: 'Pod deletion triggers the kubelet’s preStop/SIGTERM and the EndpointSlice update concurrently. kube-proxy on every node, ingress controllers and cloud LBs converge over the next 1–3 s (much longer for ALB target deregistration), so a pod that exits on SIGTERM still receives new connections and loses in-flight ones. Fix: a preStop sleep longer than propagation, then graceful shutdown that stops accepting, drains in-flight work and closes keep-alives. Also set `terminationGracePeriodSeconds` above sleep + drain, use a meaningful readiness probe and a conservative `maxUnavailable`, and enable ingress retries for idempotent requests.',
      followUps: [
        'Why doesn’t removing the pod from endpoints close existing connections?',
        'How does this differ behind an AWS ALB with IP targets?',
        'What about long-lived gRPC streams or WebSockets?',
      ],
      seniorSignal: 'Explains the concurrency between kubelet and endpoint controllers and the connection vs endpoint distinction, not just “add a preStop hook”.',
    },
    {
      q: 'The registry is down. What happens to traffic, and what did you have to design in advance?',
      a: 'If designed correctly, nothing visible at first. Every client, sidecar and kube-proxy keeps routing on its cached list, while new instances get no traffic, dead ones are not removed and autoscaling stops helping, so staleness grows. That requires caching last-known-good (ideally persisted for cold starts), not blocking startup on registration, not treating an empty or failed response as “zero instances”, and caller retries plus outlier detection to route around dead entries. Operationally: freeze deploys, restore quorum, and expect a re-registration and re-list storm on recovery, so use jitter.',
      followUps: [
        'A pod restarts during the outage. Can it find its dependencies?',
        'How do you avoid the recovery storm?',
        'What did Roblox’s 2021 outage teach about registry dependencies?',
      ],
      seniorSignal: 'Treats the registry as control plane with explicit degraded-mode behaviour and plans for the recovery storm.',
    },
    {
      q: 'Eureka self-preservation: bug or feature?',
      a: 'Feature with a sharp edge. If renewals drop below 85% of expected, Eureka assumes the registry is partitioned, not that 15%+ of the fleet died at once, so it stops evicting rather than mass-deleting healthy instances. That is right for network partitions and wrong for real mass failure (an AZ loss, a crash-looping deploy), where it keeps advertising corpses until renewals recover. It also misfires on small fleets, where one instance is more than 15%. It is acceptable only if clients retry on another instance and eject outliers, instances cancel their lease on graceful shutdown, and you alert on sustained self-preservation.',
      followUps: [
        'How is the expected-renewals threshold computed and refreshed?',
        'Would you disable it in a 4-instance dev environment?',
        'How does a CP registry handle the same scenario?',
      ],
      seniorSignal: 'Knows the mechanism (renewal threshold, eviction cap) and maps it to the failure it optimises for and the one it worsens.',
    },
    {
      q: '10,000 clients watch a popular service. Each deploy melts the registry. What is happening and how do you fix it?',
      a: 'It is a thundering herd. Each endpoint change notifies 10k watchers, and with ZooKeeper one-shot watches or full-object payloads, all 10k re-read the whole list at once, for each of hundreds of changes per rollout. Fixes reduce payload, watchers or synchrony: send deltas (EndpointSlices, delta xDS, Eureka deltas), coalesce watches through node-local agents or sidecars so 10k clients become ~500 node watchers, debounce and batch changes at the control plane, and jitter polls and re-lists. Also check for 410/compaction re-lists, which multiply the load.',
      followUps: [
        'How does Consul’s blocking query jitter help?',
        'Why do EndpointSlices reduce kube-apiserver bandwidth by ~50× in the 5,000-pod case?',
        'What does istiod’s debounce trade off?',
      ],
      seniorSignal: 'Quantifies fan-out (watchers × changes × payload) and attacks each factor separately.',
    },
    {
      q: 'Your gRPC service behind a ClusterIP sends all traffic to one or two pods after scaling out. Why?',
      a: 'kube-proxy balances at L4. The DNAT decision happens on the first packet and conntrack pins the flow, so a gRPC client with one long-lived HTTP/2 connection sends every request to the same pod, and new pods only get new connections. Options: a headless Service with gRPC client-side round robin (but its DNS resolver only re-resolves on connection events), server-side `MaxConnectionAge` to force periodic reconnects, or an L7 balancer that balances per request (Envoy/mesh, proxyless gRPC xDS).',
      followUps: [
        'Why doesn’t lowering the DNS TTL fix it?',
        'How do you rebalance long-lived streams without dropping them?',
        'Would IPVS mode change anything?',
      ],
      seniorSignal: 'Recognises the connection-vs-request distinction and that discovery freshness is irrelevant when connections are pinned.',
    },
  ],

  // ───────────────────────── 10. Takeaways ─────────────────────────
  takeaways: [
    'Registry = control plane; the data plane must keep routing on cached last-known-good when it is down.',
    'Staleness = detection + propagation + every cache layer; Eureka defaults add up to ~3–4 minutes, k8s readiness to ~30 s.',
    'CP catalog or AP catalog, the edges are always AP: retries to another host and outlier detection fix what discovery can’t.',
    'Heartbeats prove a process is alive; health checks prove it can serve. Readiness gates traffic, liveness restarts.',
    'Kubernetes deletes pods and endpoints concurrently: preStop sleep + graceful drain, or every rollout drops requests.',
    'DNS TTLs are advisory and connection pools never re-resolve; L4 VIPs balance connections, not requests.',
    'Discovery scales by fan-out (watchers × changes × payload): deltas, slices, scoping, coalescing and jitter.',
  ],
};

export default deep;
