import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'dns',

  problem: {
    why: 'Clients need a stable **name** while the IPs behind it change: servers move, regions fail, load balancers scale and get new addresses. DNS is a hierarchical, delegated, heavily cached key-value lookup (name, type → records) that makes those changes possible without touching clients. Because the authoritative server can compute the answer per query, it also doubles as the coarsest traffic-steering layer on the internet: which region, which provider, what share of users.',
    withoutIt: [
      'Every client hard-codes IPs; moving a service or replacing an LB means shipping new clients.',
      'No way to send European users to the EU region and US users to the US region from one hostname.',
      'Region failover needs clients to know about the standby; with DNS, a health-checked record swap does it.',
      'Gradual migrations (10% of users to the new provider/region) have no lever before the first TCP packet.',
      'Mail routing (MX), domain verification (TXT), and certificate issuance (ACME DNS-01, CAA) all lose their anchor.',
    ],
    position: 'The very first step of every request, before TCP: stub resolver → recursive resolver → (on miss) root → TLD → authoritative. The answer usually points at a CDN, a global anycast front door, or a regional load balancer; DNS is never in the data path after that.',
    diagram: {
      type: 'flow',
      title: 'DNS is step zero',
      nodes: [
        { label: 'Browser / app', sub: 'needs api.example.com' },
        { label: 'Stub + OS cache', sub: 'getaddrinfo, ~µs on hit', tone: 'neutral' },
        { label: 'Recursive resolver', sub: 'ISP or 1.1.1.1 / 8.8.8.8', tone: 'info' },
        { label: 'Authoritative DNS', sub: 'Route 53, computes answer', tone: 'accent' },
        { label: 'LB / CDN IP', sub: 'then TCP + TLS', tone: 'ok' },
      ],
      caption: 'Root and TLD servers are consulted only on cold caches; most lookups end at the resolver.',
    },
  },

  architecture: {
    overview: 'DNS splits into two very different systems. **Recursive resolvers** are caches that do the work on behalf of clients: they iterate the delegation chain, validate DNSSEC, and store positive and negative answers for their TTL. **Authoritative servers** own zones and answer only for them, today usually as anycast fleets serving the zone from memory, with a policy engine that picks the answer per query from the resolver’s location, health checks and weights. Delegation (NS records plus glue) stitches root → TLD → zone together.',
    diagram: {
      type: 'layers',
      title: 'Who holds what',
      layers: [
        { name: 'Client side', items: ['Browser host cache', 'OS stub resolver', 'App / JVM cache', 'Connection pools'], tone: 'neutral' },
        { name: 'Recursive resolver', items: ['Shared cache (TTL)', 'Negative cache', 'Iteration + retries', 'DNSSEC validation'], tone: 'info' },
        { name: 'Delegation chain', items: ['Root (13 identities)', 'TLD (.com: Verisign)', 'NS + glue records'], tone: 'violet' },
        { name: 'Authoritative', items: ['Zone store in RAM', 'Policy engine (geo/latency)', 'Health checkers', 'Anycast PoPs'], tone: 'accent' },
      ],
      caption: 'Each layer caches; the closer to the client, the less it respects your TTL.',
    },
    blocks: [
      { name: 'Stub resolver', what: 'The OS client (`getaddrinfo`, `systemd-resolved`, macOS `mDNSResponder`) that sends one recursive query (UDP/53, or DoT/DoH) to the configured resolver, with a small local cache and search-domain expansion (`ndots` in `/etc/resolv.conf`).' },
      { name: 'Resolver cache', what: 'Keyed by (name, type, class); each entry stores the record set and an absolute expiry derived from the TTL. Big public resolvers run many independent caches per PoP, so "the" cache is really thousands of them.' },
      { name: 'Negative cache', what: 'NXDOMAIN and NODATA answers are cached too (RFC 2308) for the minimum of the SOA record’s TTL and its MINIMUM field, so a typo-ed or not-yet-created record stays "missing" for that long.' },
      { name: 'Delegation (NS + glue)', what: 'A parent zone says "this child is served by these nameservers" and, when the NS names are inside the child, includes their IPs (glue). `.com` NS delegations carry a 2-day TTL, which is why changing nameservers is slow.' },
      { name: 'Authoritative zone store', what: 'Classic: zone files replicated by AXFR/IXFR zone transfer with SOA serials and NOTIFY. Modern providers: an API-driven database pushed to every anycast PoP in seconds and served from memory.' },
      { name: 'Traffic policy engine', what: 'Per-query answer selection: geolocation, latency-based (from measured region latencies), weighted, failover, multivalue; inputs are the resolver IP or the EDNS Client Subnet plus health state.' },
      { name: 'Health checkers', what: 'Distributed probers in several regions hit each endpoint; a quorum decides healthy/unhealthy, which removes the record from answers. Route 53 counts an endpoint healthy if more than 18% of its checkers say so.' },
    ],
    real: [
      { name: 'BIND / Unbound / CoreDNS', how: 'BIND is the reference authoritative + recursive server (zone files, AXFR/IXFR). Unbound is a validating, caching recursive resolver with prefetch and serve-stale. CoreDNS is a Go plugin chain (`kubernetes`, `cache`, `forward`) and the default cluster DNS in Kubernetes, answering `svc.cluster.local` from the API server’s watch.' },
      { name: 'Amazon Route 53', how: 'Authoritative only. Each hosted zone gets 4 nameservers on 4 different TLDs (.com, .net, .org, .co.uk) for blast-radius isolation, all anycast. Routing policies: simple, weighted, latency, geolocation, geoproximity, failover, multivalue; alias records resolve AWS resources (ALB, CloudFront) at the apex. Health checks every 30 s (or 10 s fast), failure threshold 3 by default. 100% availability SLA.' },
      { name: 'Cloudflare DNS and 1.1.1.1', how: 'One global anycast network serves both authoritative DNS and the 1.1.1.1 public resolver from every PoP. Authoritative features include CNAME flattening at the zone apex and "proxied" records that return Cloudflare’s anycast IPs instead of the origin. 1.1.1.1 deliberately does **not** send EDNS Client Subnet, for privacy.' },
      { name: 'Google Public DNS (8.8.8.8)', how: 'Anycast recursive resolver with many cache shards per location; sends ECS to authoritative servers that support it so CDNs can geo-target; validates DNSSEC; supports DoH/DoT.' },
      { name: 'NS1 / Akamai Edge DNS', how: 'Traffic-management authoritative DNS. NS1 runs a per-record **filter chain** (e.g. up → geotarget → weighted shuffle → select first N) fed by monitoring and real-user telemetry; Akamai serves zones from a large anycast footprint with GTM for global load balancing.' },
    ],
  },

  lifecycle: {
    summary: 'A cold lookup of `api.example.com` through the full chain. A warm lookup stops at stage 1, 2 or 3; the cold path costs 50–200 ms and happens only when every cache layer has expired the name.',
    stages: [
      { stage: 'Browser host cache', what: 'Chrome/Firefox check their in-process cache (with its own TTL cap) and coalesce concurrent lookups for the same name.', cost: 'µs on hit', ms: 0.01, part: 'stub' },
      { stage: 'OS stub cache', what: '`getaddrinfo` → `systemd-resolved` / `mDNSResponder` cache; then `/etc/hosts`; then a UDP query to the resolver. Search domains can multiply this (Kubernetes `ndots:5`).', cost: '~0.05 ms on hit', ms: 0.05, part: 'stub' },
      { stage: 'Recursive resolver', what: 'Query reaches the nearest resolver instance (anycast). On a cache hit it answers immediately; the cost is the network RTT to the resolver.', cost: '1–20 ms RTT', ms: 8, part: 'recursive' },
      { stage: 'Root referral (cold only)', what: 'Only if the resolver lacks the `.com` NS set, which it almost always has cached (2-day TTL). The root returns a referral, never an answer.', cost: '~0 amortised; 10–30 ms if needed', ms: 0, part: 'root' },
      { stage: 'TLD referral', what: 'The `.com` servers return the NS records for `example.com` plus glue. Cached for up to 2 days, so this is rare for popular domains.', cost: '10–40 ms RTT on miss', ms: 20, part: 'tld' },
      { stage: 'Authoritative query', what: 'The resolver asks the nearest anycast instance of the zone’s nameservers. Retries with backoff to another NS if one times out.', cost: '5–40 ms RTT', ms: 20, part: 'authoritative' },
      { stage: 'Policy evaluation', what: 'Authoritative picks the answer: ECS or resolver IP → geo/latency region, filter out unhealthy endpoints, apply weights; attaches TTL 60.', cost: 'µs in memory', ms: 0.05, part: 'health' },
      { stage: 'Cache + return', what: 'Resolver caches positive (and any negative) answers, then replies to the stub, which caches per OS/browser policy.', cost: 'µs', ms: 0.05, part: 'recursive' },
    ],
  },

  deepDives: [
    {
      title: 'Resolution path and the caching layers',
      hook: 'There are at least five caches between you and your authoritative server, and only one of them is yours.',
      body: [
        'A recursive resolver does **iterative** resolution: it asks the root, gets a referral to `.com`, asks `.com`, gets a referral to `example.com`’s nameservers, and asks them. Every referral and answer is cached for its TTL, so for popular domains the root and TLD are almost never touched.',
        'Caches stack: browser → OS → (app runtime) → resolver → authoritative. Each layer decrements the remaining TTL when it hands out a cached answer, so a downstream cache never holds a record longer than the upstream was told, at least in theory.',
        'The practical consequence for system design: the authoritative server sees **resolver** traffic, not user traffic. One answer from Route 53 may be served from cache to hundreds of thousands of users behind a large ISP resolver.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Cold resolution of api.example.com',
        actors: ['Stub', 'Resolver', 'Root', 'TLD .com', 'Authoritative'],
        messages: [
          { from: 'Stub', to: 'Resolver', label: 'A api.example.com? (RD=1)' },
          { from: 'Resolver', to: 'Root', label: 'A api.example.com?' },
          { from: 'Root', to: 'Resolver', label: 'referral: .com NS', dashed: true },
          { from: 'Resolver', to: 'TLD .com', label: 'A api.example.com?' },
          { from: 'TLD .com', to: 'Resolver', label: 'referral: example.com NS + glue', dashed: true },
          { from: 'Resolver', to: 'Authoritative', label: 'A api.example.com? (+ECS)' },
          { from: 'Authoritative', to: 'Resolver', label: 'A 203.0.113.10 TTL 60', dashed: true, tone: 'ok' },
          { from: 'Resolver', to: 'Stub', label: 'answer (cached 60 s)', dashed: true },
        ],
      },
      code: {
        lang: 'bash',
        caption: 'See the delegation chain and remaining TTLs yourself',
        code: `dig +trace api.example.com          # iterate from the root like a resolver
dig api.example.com @1.1.1.1        # TTL shown = remaining time in that cache
dig api.example.com @ns-123.awsdns-15.com +norecurse   # ask authoritative directly
dig +short example.com NS
dig example.com SOA                 # last field = negative-caching MINIMUM`,
      },
      insight: 'When debugging "DNS hasn’t propagated", there is no propagation: there are caches that have not expired yet. Query the authoritative directly to see the truth, then the resolver to see how long it will keep lying.',
    },
    {
      title: 'TTL trade-offs and clients that ignore them',
      hook: 'TTL is the knob that trades failover speed against cost and resilience, and many clients do not honour it.',
      body: [
        'Short TTLs (30–60 s) let you steer and fail over quickly but multiply authoritative query volume (cost, latency on cache miss) and make you more exposed to a DNS provider outage, because caches drain within a minute. Long TTLs (hours to days) make lookups nearly free and survive provider outages, but mistakes and migrations take hours to undo.',
        'Real clients deviate. Old JVMs cached forever; current ones use `networkaddress.cache.ttl` (30 s default without a security manager, forever with one). Browsers apply their own caps. Some resolvers enforce a minimum TTL. Mobile apps and SDKs cache resolved addresses in memory for the process lifetime.',
        'The biggest deviation is not a DNS cache at all: **connection pools and keep-alive**. A client holding an HTTP/2 or database connection never re-resolves until it reconnects, so a DNS failover affects new connections only. Long-lived clients can keep hitting a dead or drained region for hours.',
      ],
      table: {
        caption: 'Where stale answers hide',
        columns: ['Layer', 'Typical behaviour', 'Mitigation'],
        rows: [
          ['Recursive resolver', 'Honours TTL; some floor it, some serve stale on errors', 'Short TTL on steered records'],
          ['Browser', 'Own host cache, about 1 min', 'Nothing; plan for it'],
          ['JVM', '`networkaddress.cache.ttl` 30 s (forever with security manager)', 'Set explicitly, e.g. 30–60 s'],
          ['App/SDK', 'Resolve once at startup', 'Re-resolve on connection errors'],
          ['Connection pools', 'Never re-resolve while connected', 'Max connection age, reconnect on failover'],
        ],
      },
      insight: 'Lower the TTL **a full old-TTL period before** a planned migration (a day ahead for a 1-day TTL). Lowering it at cutover time does nothing for answers already cached with the long TTL.',
    },
    {
      title: 'Traffic steering: GeoDNS, latency-based, weighted, ECS',
      hook: 'The authoritative server can return a different answer per query, but it only sees the resolver, not the user.',
      body: [
        '**Geolocation** maps the source IP to a country/continent. **Latency-based** (Route 53) maps it to the AWS region with the lowest measured latency from that network. **Weighted** returns records in proportion to weights for canaries or gradual migrations; **multivalue** returns several healthy IPs for client-side choice.',
        'The source IP is the recursive resolver’s. A user in Mumbai on a resolver in Singapore gets Singapore’s answer. **EDNS Client Subnet** (RFC 7871) lets the resolver pass a truncated client prefix (typically /24 for IPv4) so the authoritative can geo-target the user; the answer is then cached per subnet, which fragments resolver caches and leaks some privacy. Google Public DNS sends ECS; Cloudflare 1.1.1.1 does not.',
        'DNS steering is coarse: per resolver, per TTL, and blind to real load. It is good at choosing a region; it is bad at balancing within one.',
      ],
      diagram: {
        type: 'compare',
        title: 'What the authoritative sees',
        columns: [
          { name: 'Without ECS', points: ['Resolver IP only', 'User on far resolver misrouted', 'One cache entry for all', 'Better privacy'], tone: 'warn' },
          { name: 'With ECS', points: ['Client /24 prefix', 'Accurate geo-targeting', 'Cache split per subnet', 'Leaks coarse location'], tone: 'ok' },
        ],
      },
      insight: 'Weighted DNS splits **resolvers**, not users: one big ISP resolver holding the 10% canary answer can send far more than 10% of real traffic to the canary for a full TTL.',
    },
    {
      title: 'Health-checked failover (Route 53 style)',
      hook: 'DNS failover works, but its speed is health-check detection time plus TTL plus client stubbornness.',
      body: [
        'Route 53 health checkers in multiple regions probe the endpoint (HTTP/HTTPS/TCP) every 30 s (or 10 s fast). After `FailureThreshold` consecutive failures (default 3) a checker marks it unhealthy; the endpoint is unhealthy when 18% or fewer checkers report healthy. A failover record pair then stops returning the primary.',
        'Worst-case failover time ≈ detection (3 × 30 s = 90 s, or ~30 s with fast checks) + record TTL (60 s) + client caching beyond TTL. Budget **2–5 minutes** for most users and accept a long tail.',
        'Health checks can also be **calculated** (healthy if N of M children are healthy) or tied to a CloudWatch alarm, so a region can be withdrawn on an SLO breach rather than a single probe.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Region failover via DNS',
        actors: ['Checkers', 'Route 53', 'Resolver', 'Client', 'us-east-1', 'us-west-2'],
        messages: [
          { from: 'Checkers', to: 'us-east-1', label: 'GET /health fails ×3', tone: 'bad' },
          { from: 'Checkers', to: 'Route 53', label: 'primary unhealthy' },
          { from: 'Resolver', to: 'Route 53', label: 'TTL expired, re-query' },
          { from: 'Route 53', to: 'Resolver', label: 'secondary IP (us-west-2)', dashed: true, tone: 'ok' },
          { from: 'Client', to: 'Resolver', label: 'lookup' },
          { from: 'Client', to: 'us-west-2', label: 'new connections', tone: 'ok' },
          { from: 'Client', to: 'us-east-1', label: 'pooled conns still try', dashed: true, tone: 'warn' },
        ],
      },
      code: {
        lang: 'json',
        caption: 'Route 53 failover record (primary half)',
        code: `{
  "Name": "api.example.com", "Type": "A",
  "SetIdentifier": "primary-use1",
  "Failover": "PRIMARY",
  "HealthCheckId": "a1b2c3d4-...",
  "AliasTarget": {
    "DNSName": "my-alb-123.us-east-1.elb.amazonaws.com",
    "HostedZoneId": "Z35SXDOTRQ7X7K",
    "EvaluateTargetHealth": true
  }
}`,
      },
      insight: 'Make failover **statically stable**: the standby must already have capacity and data. Flipping DNS to a region that needs to scale up first just moves the outage.',
    },
    {
      title: 'Anycast DNS, amplification and DDoS',
      hook: 'DNS is both a favourite DDoS target and a favourite DDoS weapon.',
      body: [
        '**Anycast**: the same nameserver IP is announced via BGP from dozens to hundreds of PoPs, so queries go to the topologically nearest one and attack traffic is diluted across all of them. Every serious authoritative provider and all 13 root identities use it.',
        '**Amplification**: DNS runs over UDP, so an attacker spoofs the victim’s IP as the source and sends small queries to open resolvers that return large responses (US-CERT measured roughly 28–54× amplification). Defences: no open recursion, BCP 38 source-address filtering at ISPs, **response rate limiting** (RRL) on authoritatives, and minimal responses to `ANY` (RFC 8482).',
        '**Random-subdomain ("water torture") attacks** send queries for `x8f2k.example.com`-style names through legitimate resolvers; every query misses the cache and hits the authoritative, and resolvers themselves suffer. Defences: aggressive NSEC caching, rate limits per zone at resolvers, and large anycast capacity.',
      ],
      diagram: {
        type: 'flow',
        title: 'Reflection and amplification',
        nodes: [
          { label: 'Botnet', sub: 'spoofs victim source IP', tone: 'bad' },
          { label: 'Open resolvers', sub: '60-byte query in', tone: 'warn' },
          { label: 'Large responses', sub: '~30-50× bigger', tone: 'warn' },
          { label: 'Victim', sub: 'link saturated', tone: 'bad' },
        ],
        caption: 'Spoofing works because UDP has no handshake; TCP or cookies (RFC 7873) break the reflection.',
      },
      insight: 'Your outage risk is the **provider**, not the protocol. Use two authoritative providers (secondary DNS via zone transfer or dual-API sync) for anything business-critical, as many companies did after Dyn 2016.',
    },
    {
      title: 'Negative caching, serve-stale and record gotchas',
      hook: 'Small details that produce hours-long, hard-to-explain outages.',
      body: [
        '**Negative caching** (RFC 2308): a lookup for a name that does not exist yet caches NXDOMAIN for min(SOA TTL, SOA MINIMUM), often 300–3600 s. Classic trap: a deploy script queries a record before creating it, and clients see "does not exist" for an hour after it is created.',
        '**Serve-stale** (RFC 8767): resolvers such as Unbound can keep answering with expired data when the authoritative is unreachable, typically with a TTL of 30 s, which turns a provider outage into degraded freshness instead of total failure.',
        '**CNAME at the apex** is not allowed (it would conflict with SOA/NS), hence provider-specific ALIAS / ANAME / CNAME flattening to point `example.com` at a CDN or ALB. **Message size**: classic UDP DNS is limited to 512 bytes; EDNS0 raises it and DNS Flag Day 2020 recommended a 1232-byte buffer to avoid IP fragmentation; larger answers set TC and retry over TCP, so port 53/TCP must be open.',
      ],
      insight: 'Big DNSSEC-signed or many-record responses silently fall back to TCP; a firewall that only allows UDP/53 turns that into intermittent resolution failures for exactly your largest answers.',
    },
    {
      title: 'DNSSEC in brief',
      hook: 'It proves an answer is authentic; it does not encrypt it, and it adds a new way to break your domain.',
      body: [
        'DNSSEC signs record sets: each zone publishes `DNSKEY` records and `RRSIG` signatures, and the parent publishes a `DS` hash of the child’s key, forming a chain of trust from the root key. A validating resolver rejects forged answers (cache poisoning à la Kaminsky 2008) with SERVFAIL.',
        'Costs: bigger responses (more amplification potential and TCP fallback), key rollovers, and signature expiry. A mistake makes the domain **unresolvable for every validating resolver**, and the parent `DS` record is cached for its TTL, so rollback is slow. Privacy of queries is a separate concern handled by DoT/DoH.',
      ],
      insight: 'Treat DNSSEC changes like a schema migration with a long tail: stage them, know the DS TTL before you start, and have a tested rollback plan.',
    },
    {
      title: 'DNS as service discovery (SRV, Consul, CoreDNS) and its limits',
      hook: 'Fine for slow-moving endpoints; wrong tool for pods that come and go every minute.',
      body: [
        '`SRV` records (`_grpc._tcp.api.example.com`) carry priority, weight, port and target, so clients can discover ports and weights. Kubernetes publishes `A` records per service (the ClusterIP) and per pod for headless services; Consul exposes `service.consul` lookups with a default TTL of 0.',
        'Limits: most HTTP clients and browsers ignore SRV; clients cache and pool regardless of TTL; there is no push, so changes are discovered by polling; answers carry no load or health detail beyond presence; large record sets hit UDP size limits. Kubernetes `ndots:5` also makes every external lookup try several search domains first, multiplying query volume.',
        'For dynamic, fine-grained routing use a registry with watches (xDS, Consul/etcd/ZooKeeper watch, Kubernetes EndpointSlices) and client-side or sidecar balancing. Keep DNS for the stable entry names.',
      ],
      insight: 'A headless Kubernetes service with 200 pods returns a large answer that the client caches and pools against; scale-out and pod churn are invisible until it reconnects, the same staleness problem as cross-region failover at a smaller scale.',
    },
  ],

  scaling: {
    body: [
      'DNS scales through **caching plus anycast**: the authoritative tier only sees resolver cache misses, and each nameserver IP is served from many PoPs. Capacity planning is about query rate after caching and about surviving attacks, not about users.',
      'The data plane (anycast servers answering from memory) is separated from the control plane (API, zone database, health checkers). Changes are pushed to all PoPs, typically within seconds to a minute for managed providers; the data plane keeps serving the last-known zone if the control plane is down. Make sure your failover does not depend on making a control-plane API call during the outage: pre-provision failover records and let health checks flip them.',
      'For resilience against your provider, run **multi-provider** authoritative DNS (primary + secondary via AXFR/IXFR, or synced through both APIs) with NS records from both. Traffic-policy features (latency, weighted) usually do not sync between providers, so keep the advanced logic in one and simple records in the other, or use a global anycast front door so DNS only needs to return a static IP.',
    ],
    bullets: [
      'Authoritative load ≈ resolver caches × names × (86,400 / TTL) per day, independent of user count once caches are warm.',
      'Use ≥ 2 nameservers on separate networks (Route 53 uses 4 on different TLDs).',
      'Long TTLs on NS, MX and static records; short (30–60 s) only on records you actually steer.',
      'Health-check-driven failover records, not runbooks that call the DNS API during an incident.',
      'Combine coarse DNS steering (region) with anycast or a global LB for fast failover inside the TTL window.',
      'Internal DNS: run node-local caches (Kubernetes NodeLocal DNSCache) to cut latency and conntrack races on UDP.',
    ],
    diagram: {
      type: 'layers',
      title: 'Resilient authoritative DNS',
      layers: [
        { name: 'Zone NS set', items: ['Provider A NS × 4', 'Provider B NS × 2'], tone: 'violet' },
        { name: 'Anycast data plane', items: ['100s of PoPs', 'In-memory zones', 'RRL / DDoS scrubbing'], tone: 'info' },
        { name: 'Control plane', items: ['Zone API / DB', 'Health checkers', 'Change propagation'], tone: 'accent' },
        { name: 'Targets', items: ['Region LBs', 'Global anycast IP', 'CDN'], tone: 'ok' },
      ],
    },
  },

  failures: [
    { name: 'DNS provider outage', symptom: 'Every name on that provider fails as caches expire; perfectly healthy services become unreachable, worst for short-TTL records.', detect: 'External synthetic resolution from multiple vantage points (`dig` via several public resolvers) failing; SERVFAIL rate at resolvers; sudden drop in new-connection rate at LBs.', mitigate: 'Secondary provider with NS from both, longer TTLs on stable records, serve-stale on your own resolvers.' },
    { name: 'Slow or partial failover', symptom: 'Region marked down but traffic keeps arriving for minutes to hours from pooled connections, JVMs and SDKs.', detect: 'Request rate on the failed region by client type after the DNS flip; old-region LB `ActiveConnectionCount` not draining.', mitigate: 'Short TTL on steered records, connection max-age, client retries that re-resolve, anycast front door for sub-minute failover.' },
    { name: 'Bad record or empty answer published', symptom: 'A wrong IP, a deleted record or an empty record set is served globally within seconds and cached for its TTL.', detect: 'Config-change audit + synthetic checks comparing answers to expected values; spike of NXDOMAIN/NODATA at resolvers; error rate step change aligned with a DNS change.', mitigate: 'Change review and staged rollout of DNS changes, guard rails against empty sets, keep previous TTL low before risky changes.' },
    { name: 'Negative-cache trap', symptom: 'A newly created record keeps returning NXDOMAIN for some users for up to an hour.', detect: 'NXDOMAIN for a name that exists at the authoritative (`dig @ns ...` vs `dig @8.8.8.8 ...`); SOA MINIMUM value.', mitigate: 'Create records before anything queries them, keep SOA MINIMUM modest (e.g. 300 s).' },
    { name: 'Resolver overload / ndots storm', symptom: 'Intermittent 5 s resolution delays inside Kubernetes; timeouts on external calls.', detect: 'CoreDNS `coredns_dns_requests_total` dominated by search-domain NXDOMAINs; `coredns_forward_request_duration_seconds` p99; conntrack insert failures on UDP.', mitigate: 'Lower `ndots` or use FQDNs with trailing dot, NodeLocal DNSCache, scale CoreDNS, enable cache plugin.' },
    { name: 'DNSSEC validation failure', symptom: 'Domain resolves for some users (non-validating resolvers) and fails with SERVFAIL for others (validating ones like 8.8.8.8).', detect: 'SERVFAIL from validating resolvers only; DNSViz / `delv` showing broken chain; RRSIG expiry monitoring.', mitigate: 'Automated signing and rollover, monitor signature expiry, stage DS changes with TTL awareness.' },
  ],

  warStories: [
    {
      title: 'Dyn DDoS takes down a slice of the internet',
      source: 'Dyn, October 21, 2016',
      what: 'A Mirai botnet of compromised IoT devices (cameras, DVRs) sent waves of DNS-layer traffic at Dyn’s managed authoritative DNS. Sites that used Dyn as their only provider, including Twitter, GitHub, Netflix, Reddit and Spotify, became unreachable for many users, especially on the US East Coast, over several hours.',
      lesson: 'A single DNS provider is a single point of failure for everything under the domain. Use multiple authoritative providers and sensible TTLs so caches can carry you through an attack.',
    },
    {
      title: 'Facebook disappears from DNS',
      source: 'Facebook engineering post-mortem, October 4, 2021',
      what: 'A command during routine backbone maintenance unintentionally disconnected all of Facebook’s data centres from each other. Their authoritative DNS servers are designed to withdraw their anycast BGP routes when they cannot reach the data centres, so they did exactly that, making facebook.com, Instagram and WhatsApp unresolvable worldwide for about six hours. Internal tools depended on the same network, slowing recovery.',
      lesson: 'Health-driven withdrawal is correct per node but catastrophic when every node fails the same check at once. Keep out-of-band access, and make sure recovery tools do not depend on the system that is down.',
    },
    {
      title: 'DynamoDB endpoint resolves to nothing',
      source: 'AWS post-event summary, October 2025 (us-east-1)',
      what: 'A latent race condition in DynamoDB’s automated DNS management system left the regional endpoint `dynamodb.us-east-1.amazonaws.com` with an empty DNS record. Clients, including other AWS services, could not resolve DynamoDB for hours, and knock-on effects in services that depended on it (EC2 instance launches, load balancer health checks) extended the impact well beyond the DNS fix.',
      lesson: 'Automation that writes DNS needs guard rails (never publish an empty set for a critical name) and correct ordering under concurrency; a DNS record is a single point of failure for every client of a service.',
    },
    {
      title: 'DNSSEC rollout breaks slack.com for some users',
      source: 'Slack engineering post-mortem, September 30, 2021',
      what: 'While enabling DNSSEC on slack.com, an issue with how wildcard records were signed produced invalid negative answers, so validating resolvers failed to resolve some Slack names. Slack rolled back, but the DS record cached at resolvers kept validation failing for some users for many hours.',
      lesson: 'DNSSEC changes have a long, TTL-bounded tail. Test with validating resolvers on a non-critical zone first and know your DS TTL before you start.',
    },
  ],

  numbers: [
    { label: 'Resolver cache hit', value: '~1–20 ms', note: 'mostly network RTT to the resolver' },
    { label: 'Cold full resolution', value: '~50–200 ms', note: 'root/TLD usually cached; authoritative RTT dominates' },
    { label: 'Root servers', value: '13 identities, 1,500+ instances', note: 'all anycast' },
    { label: '.com NS delegation TTL', value: '172,800 s (2 days)', note: 'why changing nameservers is slow' },
    { label: 'Typical steered TTL', value: '30–60 s', note: 'real failover 2–5 min for most clients' },
    { label: 'Route 53 health checks', value: '30 s (or 10 s), threshold 3', note: 'healthy if > 18% of checkers agree' },
    { label: 'Route 53 standard queries', value: '$0.40 per million', note: 'first billion/month; latency/geo cost more' },
    { label: 'UDP payload', value: '512 B classic, 1232 B EDNS', note: 'larger → TC bit, retry over TCP' },
    { label: 'Amplification factor', value: '~28–54×', note: 'US-CERT TA13-088A' },
    { label: 'JVM default DNS cache', value: '30 s', note: 'forever when a security manager is installed' },
    { label: 'Kubernetes default ndots', value: '5', note: 'external names try search domains first' },
  ],

  capacity: {
    question: 'An app has 50M daily users. Its API record uses TTL 60 s on Route 53 with latency-based routing. Roughly how many authoritative queries per day, and what does raising the TTL to 300 s change?',
    steps: [
      'Authoritative load depends on resolver caches, not users. Assume ~200k distinct active resolver caches (ISP resolvers plus the many cache shards of public resolvers) serve those users.',
      'Each cache re-queries at most once per TTL while users are active: 86,400 / 60 = 1,440 queries per cache per day per name.',
      'Five names (api, www, static, auth, ws): 200k × 5 × 1,440 ≈ 1.44 B queries/day ≈ 17k QPS average, maybe 3× at peak.',
      'Latency-based queries cost ~$0.60 per million: 1.44 B × $0.60/M ≈ $860/day ≈ $26k/month.',
      'With TTL 300 s: 5× fewer queries ≈ 290 M/day ≈ $5k/month, but worst-case DNS failover grows by ~4 minutes.',
    ],
    answer: '~1.4 B queries/day (~17k QPS) at TTL 60, roughly $26k/month on latency records; TTL 300 cuts it 5×. Query cost is driven by TTL and resolver count, so short TTLs belong only on the few records you actually steer.',
  },

  comparison: {
    caption: 'Authoritative DNS options',
    columns: ['Product', 'Model', 'Traffic steering', 'Health checks', 'Notable'],
    rows: [
      ['Amazon Route 53', 'Managed, anycast, 4 NS on 4 TLDs', 'Weighted, latency, geo, geoproximity, failover, multivalue', 'Built in, multi-region, calculated, CloudWatch', 'Alias at apex to AWS resources, 100% SLA'],
      ['Cloudflare DNS', 'Managed, one global anycast network', 'Via add-on Load Balancing (geo, weighted, health)', 'In Load Balancing add-on', 'CNAME flattening, proxied records hide origin'],
      ['NS1', 'Managed traffic-management DNS', 'Filter chains, real-user telemetry', 'Monitors feed filters', 'Fine-grained per-record logic'],
      ['Google Cloud DNS', 'Managed, anycast', 'Geolocation and weighted routing policies', 'For supported LB targets', 'Tight GCP integration, private zones'],
      ['BIND / CoreDNS (self-hosted)', 'Your servers, zone files or plugins', 'Views (BIND), plugins (CoreDNS)', 'DIY', 'Full control; internal / cluster DNS'],
    ],
  },

  whenNot: [
    'As your load balancer within a region: no load awareness, coarse per-resolver splits, stale caching; put a real LB (VIP or anycast) behind one DNS name.',
    'For sub-minute failover: TTLs and client caching make DNS failover minutes long; use anycast or a global LB whose IP never changes.',
    'For fast-changing service discovery (pods, autoscaled tasks): use a registry with watches (xDS, EndpointSlices, Consul) and client or sidecar balancing.',
    'For per-request routing decisions (canary by header, user cohort): DNS cannot see the request; do it in the L7 LB or gateway.',
    'As a config or feature-flag store via TXT records: caching and size limits make it slow and fragile; use a config service.',
  ],

  interview: [
    {
      q: 'Design multi-region active-active for an API. What role does DNS play, and what are its limits?',
      a: 'DNS picks the region: latency-based or geo records on Route 53, each pointing at a regional LB, with health checks so an unhealthy region is removed. Limits: the authoritative sees the resolver not the user (ECS helps), answers are cached for the TTL and longer by clients, and connection pools never re-resolve. So I would use a short TTL on that record only, make each region statically able to absorb the other’s load, and for faster failover put a global anycast front door (Global Accelerator, Cloudflare, GCP global LB) in front, with DNS returning a stable anycast IP.',
      followUps: ['How long will failover actually take?', 'How do you avoid split traffic while data replicates?', 'What does ECS change?'],
      seniorSignal: 'Quantifies failover time from detection + TTL + client behaviour and pairs DNS with anycast rather than relying on it alone.',
    },
    {
      q: 'You lowered the TTL to 60 s and failed over, but 20% of traffic still hits the old region an hour later. Why?',
      a: 'Clients that do not re-resolve: long-lived keep-alive, HTTP/2, gRPC and database connections stay open to the old IPs; some runtimes and SDKs cache addresses for the process lifetime; some resolvers enforce minimum TTLs or serve stale. If the TTL was lowered at failover time, resolvers still held the old long-TTL answer. Fixes: lower TTLs a full TTL period ahead, cap connection age, make clients re-resolve on connection errors, and drain the old region so it closes connections.',
      followUps: ['How would you find which clients are stuck?', 'Would anycast avoid this?', 'What about mobile apps?'],
      seniorSignal: 'Knows that connection reuse, not DNS caching, is usually the dominant source of stale routing.',
    },
    {
      q: 'How does GeoDNS know where the user is, and when does it get it wrong?',
      a: 'It geolocates the source IP of the query, which is the recursive resolver’s. Users on a distant public or corporate resolver, or on VPNs, are misrouted. EDNS Client Subnet passes a truncated client prefix (usually /24) to fix that, at the cost of fragmenting resolver caches and some privacy; not all resolvers send it (1.1.1.1 does not). Anycast resolvers sitting close to users reduce the error even without ECS.',
      followUps: ['How does ECS affect cache hit rates?', 'How would you measure misrouting?', 'Latency-based vs geo — which and why?'],
      seniorSignal: 'Explains the resolver-vs-client distinction and ECS trade-offs, and suggests measuring with real-user telemetry.',
    },
    {
      q: 'How would you protect your company from a DNS provider outage like Dyn 2016?',
      a: 'Run two authoritative providers with NS records from both at the registrar, kept in sync by zone transfer (one primary, one secondary) or by deploying to both APIs from a single source of truth. Use longer TTLs on stable records so caches carry traffic through an outage, and keep traffic-steering logic simple enough to exist in both providers or move it to an anycast front door. Monitor resolution from many external vantage points, and verify registrar access and NS TTLs in advance.',
      followUps: ['What features do you lose with two providers?', 'How do you sync zones safely?', 'What about the registrar itself?'],
      seniorSignal: 'Covers provider diversity and the trade-off with steering features, not just "add a second provider".',
    },
    {
      q: 'Why not use DNS for service discovery between microservices?',
      a: 'It works for stable names, but endpoints change faster than caches expire, clients cache and pool regardless of TTL, there is no push so changes are seen by polling, answers carry no load or health detail, and large record sets spill to TCP. In Kubernetes, ClusterIP DNS plus kube-proxy hides pods behind a stable IP, which is fine, but headless services give clients stale pod lists. For dynamic routing I would use a registry with watches (EndpointSlices, xDS, Consul) and client-side or sidecar balancing.',
      followUps: ['What does ndots:5 do?', 'How does Consul DNS handle TTLs?', 'When is SRV a good fit?'],
      seniorSignal: 'Separates stable entry names from dynamic endpoint sets and knows Kubernetes DNS specifics.',
    },
    {
      q: 'Explain DNS amplification and how DNS operators defend against it.',
      a: 'Attackers spoof the victim’s IP and send small UDP queries to open resolvers or authoritatives that return much larger answers, reflecting tens of times more traffic at the victim. Defences: no open recursion, BCP 38 source-address filtering, response rate limiting on authoritatives, minimal ANY responses, DNS cookies, and anycast capacity to absorb floods. Random-subdomain attacks are the other big class: they bypass caches and hit the authoritative directly.',
      followUps: ['Why does DNSSEC make amplification worse?', 'How does anycast help?', 'How do you detect a water-torture attack?'],
      seniorSignal: 'Distinguishes reflection attacks from cache-busting attacks and maps each to a concrete defence.',
    },
  ],

  takeaways: [
    'DNS is a hierarchy of caches; the authoritative sees resolvers, not users.',
    'TTL trades failover speed against cost and outage resilience; short TTLs only on steered records.',
    'Real failover is detection + TTL + client stubbornness: budget minutes, and connection pools never re-resolve.',
    'GeoDNS is per resolver; ECS improves accuracy at the cost of cache fragmentation and privacy.',
    'A single DNS provider is a single point of failure for the whole domain (Dyn 2016, Facebook 2021).',
    'Use DNS for coarse region choice and stable names; use LBs, anycast and registries for everything finer.',
    'Negative caching, DNSSEC and empty record sets cause long-tail outages; stage DNS changes like migrations.',
  ],
};

export default deep;
