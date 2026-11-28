import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'ws-gateway',

  problem: {
    why: 'HTTP is request/response: the server cannot speak until the client asks. Chat, collaboration, live dashboards, games and notifications need the server to push within milliseconds. A WebSocket gateway keeps one long-lived, full-duplex connection per client open and turns "deliver event E to user U" into a write on the right socket. Its whole design is about holding millions of mostly idle connections cheaply and finding the right one fast.',
    withoutIt: [
      'Clients short-poll: load ∝ clients ÷ interval, mostly empty responses, latency ≈ interval ÷ 2.',
      'Stateless app servers end up holding sockets, so every deploy or autoscale event drops users.',
      'No way to route "message for user 42" to the one box holding user 42’s connection.',
      'Large rooms (100k members) melt whichever server tries to fan out naively.',
      'Presence ("online", "typing") either does not exist or hammers the database.',
    ],
    position: 'At the edge, behind an L4/L7 load balancer that supports Upgrade and long idle timeouts; it authenticates once on connect, registers the connection, subscribes to a pub/sub backplane and forwards client frames to backend services over normal RPC.',
    diagram: {
      type: 'flow',
      title: 'Where the gateway sits',
      nodes: [
        { label: 'Clients', sub: 'web / mobile / desktop' },
        { label: 'L4/L7 LB', sub: 'Upgrade, idle ≥ heartbeat', tone: 'info' },
        { label: 'WS gateways', sub: 'hold sockets, stateful', tone: 'accent' },
        { label: 'Backplane', sub: 'Redis / NATS / Kafka', tone: 'violet' },
        { label: 'Services', sub: 'chat, presence, notify', tone: 'ok' },
        { label: 'Durable store', sub: 'messages + cursors' },
      ],
      caption: 'The socket is a delivery channel; truth lives in the durable store.',
    },
  },

  architecture: {
    overview: 'A gateway node is an event loop (epoll/kqueue) over hundreds of thousands of sockets, plus per-connection state: user id, subscriptions, a bounded outbound queue and heartbeat timers. Around it sit a **connection registry** (user/device → node), a **pub/sub backplane** that routes events to the nodes that own the recipients, and a **durable message store** so clients can resume from a cursor after reconnecting. The gateway is deliberately thin: auth, routing, fan-out, backpressure — no business logic.',
    diagram: {
      type: 'layers',
      title: 'Realtime gateway architecture',
      layers: [
        { name: 'Edge', items: ['DNS / anycast', 'L4 LB (least-conn)', 'TLS termination', 'Upgrade → 101'], tone: 'info' },
        { name: 'Gateway node', items: ['epoll event loop', 'Per-conn send queue', 'Heartbeat timers', 'Subscriptions'], tone: 'accent' },
        { name: 'Routing', items: ['Connection registry', 'Pub/sub backplane', 'Room/channel servers', 'Presence service'], tone: 'violet' },
        { name: 'Durability', items: ['Message log / DB', 'Per-client cursor', 'Push (APNs/FCM)'], tone: 'ok' },
      ],
      caption: 'Gateways are stateful only in memory; registry + log let any node replace any other.',
    },
    blocks: [
      { name: 'Event loop + socket table', what: 'A few threads each own an `epoll` set of sockets (Netty, Go netpoller, BEAM schedulers, Rust tokio). An idle connection costs a file descriptor, kernel socket buffers and a small user-space struct — no thread.' },
      { name: 'Handshake + auth', what: 'HTTP `GET` with `Upgrade: websocket` and `Sec-WebSocket-Key`; validate a short-lived token (cookie or query param) **before** replying `101 Switching Protocols`, and enforce `Origin` checks to stop cross-site WebSocket hijacking.' },
      { name: 'Heartbeats', what: 'WebSocket ping (opcode 0x9) / pong (0xA) or app-level heartbeats every 20–45 s. Detect dead peers (half-open TCP never errors on its own), keep NAT and LB idle timers alive, and refresh registry TTLs.' },
      { name: 'Connection registry', what: 'Redis/KV entries like `conn:user:42 → {gw-17, device}` with a TTL refreshed by heartbeats. Supports multiple devices per user and is needed for targeted 1:1 delivery and presence.' },
      { name: 'Pub/sub backplane', what: 'Routes events to the nodes owning the recipients: per-node channels (registry lookup then publish), per-room topics (nodes subscribe to rooms they have members in), or a broadcast bus for small fleets. Redis Pub/Sub, NATS, or in-cluster Erlang distribution.' },
      { name: 'Per-connection send queue', what: 'Bounded buffer between the router and the socket. When a slow client cannot drain it, drop low-value events (typing, presence) or disconnect — never let it grow unbounded.' },
      { name: 'Resume cursor + durable log', what: 'Each message has a sequence/offset; clients reconnect with their last seen id and fetch the gap from storage. This makes the socket "best effort, fast" and the log "complete, correct".' },
    ],
    real: [
      { name: 'Discord', how: 'Elixir/Erlang gateway: one BEAM process per session and one per guild; guild processes fan out to session processes across nodes, batched with their Manifold library. For million-member servers (Midjourney, 2023) they added relay processes and passive sessions so fan-out is split and idle members get less traffic.' },
      { name: 'Slack', how: 'Gateway Servers hold client WebSockets regionally and subscribe to stateful **Channel Servers** (consistent-hashed by channel) for the channels their users are in; Presence Servers track online state. **Flannel** (2017) is an edge cache that serves boot/lazy-load queries next to the socket. Slack migrated its WebSocket edge from HAProxy to Envoy (2021).' },
      { name: 'WhatsApp', how: 'Erlang on FreeBSD, tuned to hold **2M+ concurrent TCP connections per server** (2012). Minimal per-connection state, kernel tuning for fds and buffers, and messages stored only until delivered.' },
      { name: 'Phoenix Channels (Elixir)', how: 'Topic-based pub/sub over WebSockets with a distributed PubSub (PG2 or Redis adapter). The Phoenix team showed **2M connections on one 40-core, 128 GB box** (2015), limited mostly by memory.' },
      { name: 'AWS API Gateway WebSocket / Ably / Pusher', how: 'Managed: the provider holds sockets and gives you a connection id; your backend pushes via an HTTP API (`POST @connections/{id}`). No sockets to operate, but per-message and per-connection-minute pricing and higher latency.' },
    ],
  },

  lifecycle: {
    summary: 'A mobile client connects over 4G (RTT ~50 ms), then receives a chat message published by another user on a different gateway node.',
    stages: [
      { stage: 'TCP + TLS 1.3', what: 'Connect to the LB VIP; TLS terminated at LB or gateway.', cost: '1 RTT TCP + 1 RTT TLS', ms: 100 },
      { stage: 'HTTP Upgrade', what: '`GET /ws` with `Upgrade: websocket`, `Sec-WebSocket-Key`; LB pins this TCP connection to one gateway.', cost: '1 RTT', ms: 50 },
      { stage: 'Auth', what: 'Gateway verifies a JWT (signature + expiry + Origin) before `101`.', cost: 'Local crypto', ms: 0.05 },
      { stage: 'Register + subscribe', what: '`SET conn:user:42 gw-17 EX 90`, subscribe to user/room channels.', cost: 'Redis RTT ×2', ms: 1 },
      { stage: 'Resume', what: 'Client sends last seen message id; gateway fetches the gap from the message store.', cost: 'One DB/cache read', ms: 5 },
      { stage: 'Idle', what: 'Socket sits in epoll; ping/pong every 30 s refreshes the registry TTL.', cost: 'Memory only, ~0 CPU', ms: 0 },
      { stage: 'Publish', what: 'Chat service persists the message, then publishes to the room topic.', cost: 'DB write + bus publish', ms: 3 },
      { stage: 'Backplane → gateway', what: 'gw-17 receives the event for a room it has members in, looks up local sockets.', cost: 'Bus hop', ms: 1 },
      { stage: 'Frame write', what: 'Enqueue to the connection’s bounded send queue; event loop writes the frame.', cost: 'Syscall, µs', ms: 0.05 },
      { stage: 'Network to client', what: 'One-way delivery over the existing connection.', cost: '½ RTT', ms: 25 },
    ],
  },

  deepDives: [
    {
      title: 'Handshake, frames, heartbeats and idle timeouts',
      hook: 'Half the production bugs are timers: LB idle timeouts, NAT expiry and heartbeats that disagree.',
      body: [
        'RFC 6455: the client sends an HTTP/1.1 `GET` with `Upgrade: websocket`, `Connection: Upgrade`, a random `Sec-WebSocket-Key` and version 13; the server answers `101` with `Sec-WebSocket-Accept` = base64(SHA-1(key + a fixed GUID)). After that the TCP stream carries frames: FIN bit, opcode (text, binary, close, ping, pong), and length. Client-to-server frames must be **masked** with a 4-byte key to defeat cache-poisoning of intermediaries.',
        'Every hop has an idle timer: AWS ALB defaults to **60 s** (configurable up to 4,000 s), NLB TCP idle is 350 s, nginx `proxy_read_timeout` defaults to 60 s, and mobile carrier NATs may drop silent flows within minutes. The heartbeat interval must be shorter than the smallest timer on the path, with margin.',
        'TCP alone does not detect a peer that vanished (phone in a tunnel): the socket stays "open" until a write times out, potentially many minutes later. Application heartbeats with a missed-pong deadline (e.g. 2 intervals) are how you reclaim memory and mark users offline quickly.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Upgrade and keep-alive',
        actors: ['Client', 'LB', 'Gateway', 'Registry'],
        messages: [
          { from: 'Client', to: 'LB', label: 'GET /ws Upgrade + token' },
          { from: 'LB', to: 'Gateway', label: 'forward, pin connection' },
          { from: 'Gateway', to: 'Registry', label: 'SET conn:user:42 EX 90' },
          { from: 'Gateway', to: 'Client', label: '101 Switching Protocols', dashed: true, tone: 'ok' },
          { from: 'Gateway', to: 'Client', label: 'ping (every 30 s)', tone: 'info' },
          { from: 'Client', to: 'Gateway', label: 'pong', dashed: true },
          { from: 'Gateway', to: 'Registry', label: 'EXPIRE conn:user:42 90' },
          { from: 'Gateway', to: 'Client', label: 'close 1001 if 2 pongs missed', tone: 'warn' },
        ],
      },
      code: {
        lang: 'text',
        caption: 'nginx in front of a WebSocket upstream',
        code: `location /ws {
  proxy_pass http://ws_gateways;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;   # default 60s: > heartbeat interval
  proxy_send_timeout 120s;
}`,
      },
      insight: 'Use WebSocket ping/pong for liveness, but put an application-level sequence number in your own heartbeat too — browsers do not expose ping/pong to JavaScript, so only an app heartbeat lets the client detect a dead server and reconnect.',
    },
    {
      title: 'C10K to C1M: what a connection really costs',
      hook: 'Idle sockets are bounded by memory and file descriptors, not CPU — until compression and TLS buffers sneak in.',
      body: [
        'Dan Kegel’s C10K (1999) was solved by readiness APIs (`epoll`, `kqueue`) replacing thread-per-connection: one thread can watch hundreds of thousands of sockets and only touch the ready ones. A million connections on one box is now routine (WhatsApp 2M+, Phoenix 2M, Mail.Ru’s "A Million WebSockets and Go").',
        'Costs per connection: an fd, kernel socket structs and buffers (a few KB idle; `tcp_rmem`/`tcp_wmem` decide the max), TLS session state (tens of KB in many libraries unless buffers are released when idle), and your user-space state. In Go, two goroutines per connection (read + write) with 4 KB bufio buffers can cost 20–30 KB; pooled buffers and a single netpoll-driven reader cut that substantially.',
        '`permessage-deflate` with context takeover keeps a zlib window per connection — with default zlib settings roughly 256 KB for deflate plus ~40 KB for inflate. At 1M connections that is ~300 GB. Disable context takeover, shrink window bits, or compress only large messages.',
        'Ephemeral ports only limit the side that **initiates** connections. A gateway accepting on :443 has no such limit, but a proxy tier opening upstream connections to gateways gets ~28k ports per (source IP, destination IP:port) with Linux’s default `ip_local_port_range` 32768–60999. Fix with more upstream IPs/ports or source IPs.',
      ],
      table: {
        caption: 'Rough memory per idle connection',
        columns: ['Component', 'Typical', 'Lever'],
        rows: [
          ['Kernel socket + small buffers', '~4–10 KB', 'tcp_rmem/tcp_wmem minimums'],
          ['TLS state', '~10–40 KB', 'release buffers when idle'],
          ['User-space conn struct + queues', '~2–20 KB', 'pooled buffers, one reader'],
          ['Go goroutines (2 × stack)', '~8–16 KB', 'netpoll-driven design'],
          ['permessage-deflate (context takeover)', '~300 KB', 'disable takeover / window bits'],
        ],
      },
      code: {
        lang: 'bash',
        caption: 'Typical kernel tuning for 1M sockets',
        code: `# per-process and system-wide file descriptors
ulimit -n 2000000
sysctl -w fs.nr_open=2000000
sysctl -w fs.file-max=4000000
# accept backlog for reconnect bursts
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
# small default socket buffers (min default max, bytes)
sysctl -w net.ipv4.tcp_rmem="4096 8192 4194304"
sysctl -w net.ipv4.tcp_wmem="4096 8192 4194304"
# only matters for the side that dials out (proxies)
sysctl -w net.ipv4.ip_local_port_range="1024 65535"`,
      },
      insight: 'Don’t pack 1M connections on one node just because you can. Blast radius and reconnect-storm size scale with connections per node; many operators cap at 100k–500k per node so a single failure is absorbable.',
    },
    {
      title: 'Connection registry and routing over a backplane',
      hook: 'The hard problem is not pushing bytes; it is knowing which of 200 nodes holds user 42’s three devices.',
      body: [
        'Three routing strategies. **Broadcast**: every node receives every event and drops what it does not own — simple, O(nodes) waste, fine for small fleets. **Registry + targeted publish**: look up `user → node(s)` and publish to those nodes’ channels — efficient for 1:1 messaging, but the registry is on the hot path. **Topic subscription**: nodes subscribe to room/channel topics they currently have members in — natural for group chat and scales with rooms.',
        'Registry entries must expire: a node that crashes cannot delete its entries, so write them with a TTL refreshed by heartbeats, and include a connection epoch so a stale disconnect from an old node cannot delete the new entry after a fast reconnect.',
        'Redis Pub/Sub is fire-and-forget: if a gateway is disconnected from Redis for a second, it misses those messages forever. That is acceptable only because the client resumes from a cursor against the durable store. If you need the bus itself to be durable, use Kafka/NATS JetStream and accept per-partition consumer complexity.',
      ],
      diagram: {
        type: 'sequence',
        title: '1:1 message across nodes',
        actors: ['Sender', 'Chat svc', 'Registry', 'Bus', 'Gateway B', 'Client B'],
        messages: [
          { from: 'Sender', to: 'Chat svc', label: 'send(to=B, text)' },
          { from: 'Chat svc', to: 'Registry', label: 'where is B?' },
          { from: 'Registry', to: 'Chat svc', label: 'gw-9 (phone), gw-3 (web)', dashed: true },
          { from: 'Chat svc', to: 'Bus', label: 'publish node:gw-9, node:gw-3' },
          { from: 'Bus', to: 'Gateway B', label: 'event seq=981', tone: 'info' },
          { from: 'Gateway B', to: 'Client B', label: 'frame', tone: 'accent' },
          { from: 'Client B', to: 'Gateway B', label: 'ack seq=981', dashed: true },
        ],
        caption: 'Chat svc persists first (seq=981). No registry entry for B ⇒ send a push instead.',
      },
      code: {
        lang: 'text',
        caption: 'Registry with epochs (Redis)',
        code: `# on connect (epoch = monotonically increasing per user)
HSET conn:user:42 dev:phone "gw-9|epoch=17"
EXPIRE conn:user:42 90
# on heartbeat
EXPIRE conn:user:42 90
# on disconnect: delete only if still ours (Lua compare-and-delete)
EVAL "if redis.call('HGET',KEYS[1],ARGV[1])==ARGV[2] then
        return redis.call('HDEL',KEYS[1],ARGV[1]) end return 0"
     1 conn:user:42 dev:phone "gw-9|epoch=17"`,
      },
      insight: 'Treat the socket as a delivery hint, never as the record. Persist first, push second, and make clients ack by sequence number — then lost pub/sub messages, node crashes and reconnects all degrade to "slightly later" instead of "lost".',
    },
    {
      title: 'Fan-out for large rooms and presence',
      hook: 'A message to a 100k-member room is 100k socket writes; presence in that room is O(N²) if you are naive.',
      body: [
        'Fan-out cost = members online × message rate. A 100k-online room at 5 messages/s is 500k frame writes/s spread across the nodes that host those members. Route by **room topic** so each node receives one copy and fans out locally; never send 100k individual publishes through the bus. Serialize the frame once and write the same bytes to every socket.',
        'For very large rooms, split fan-out across relay processes (Discord’s approach for million-member servers), degrade gracefully (batch or sample typing/presence events), and send only what the client is viewing: Discord’s "lazy" member lists send presence for visible members rather than all of them.',
        'Presence is the hidden amplifier: if each of N members gets an update whenever any member goes online/offline, a room generates O(N²) events during reconnect storms. Coalesce presence changes per interval, cap rooms that get live presence, and derive "online" from registry TTLs rather than explicit events.',
      ],
      diagram: {
        type: 'compare',
        title: 'Fan-out strategies',
        columns: [
          { name: 'Per-user publish', points: ['1 bus msg per recipient', 'Simple targeting', '100k msgs per room post', 'Bus melts on big rooms'], tone: 'bad' },
          { name: 'Room topic per node', points: ['1 bus msg per node', 'Local fan-out', 'Serialize once', 'Default for group chat'], tone: 'ok' },
          { name: 'Relay tree', points: ['Room → relays → sessions', 'Spreads CPU', 'Extra hop', 'Mega rooms only'], tone: 'info' },
        ],
      },
      insight: 'Separate message classes by value: chat messages must arrive (persisted, cursor-resumable), while typing indicators and presence are ephemeral and should be the first thing dropped under load.',
    },
    {
      title: 'Backpressure and slow consumers',
      hook: 'One client on a bad network can OOM a gateway serving 300,000 healthy ones.',
      body: [
        'When a client reads slower than events arrive, bytes pile up in the kernel send buffer and then in your user-space queue. Without a bound, a few thousand slow clients during a busy event can exhaust memory and crash the node — disconnecting everyone on it and triggering a reconnect storm.',
        'Give each connection a bounded queue (by messages and bytes) and a write deadline. On overflow: drop droppable events first, then close the connection with `1008`/`1013` so it reconnects and resyncs from its cursor. A client that resyncs is cheaper than a client buffered forever.',
      ],
      code: {
        lang: 'go',
        caption: 'Bounded per-connection send queue',
        code: `type Conn struct {
    ws   *websocket.Conn
    send chan []byte // bounded, e.g. 256 frames
}

func (c *Conn) Enqueue(frame []byte, droppable bool) {
    select {
    case c.send <- frame:
    default: // queue full: slow consumer
        if droppable { metrics.Dropped.Inc(); return }
        metrics.SlowClose.Inc()
        c.ws.Close() // client reconnects and resumes from its cursor
    }
}

func (c *Conn) writer() {
    for f := range c.send {
        c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
        if err := c.ws.WriteMessage(websocket.BinaryMessage, f); err != nil { return }
    }
}`,
      },
      insight: 'Backpressure must also flow inward: rate-limit what clients send (messages per second, max frame size) at the gateway, or a single abusive client becomes a fan-out amplifier into every room it is in.',
    },
    {
      title: 'Deploys, draining and reconnect storms',
      hook: 'Every deploy is a planned outage for every socket on the node — do it slowly or your auth service pays.',
      body: [
        'Killing a node with 300k connections makes 300k clients reconnect at once: TLS handshakes, token validation, registry writes, resume queries and subscription setup all spike. If several nodes restart together, the herd can exceed capacity, fail, and retry again — a self-sustaining storm.',
        'Drain gradually: mark the node unhealthy at the LB so it takes no new connections, then close existing ones in batches over minutes with close code `1012` (service restart) or an app-level "reconnect" message, ideally including a retry-after hint. Kubernetes needs a long `terminationGracePeriodSeconds` and a preStop hook for this; the default 30 s is far too short.',
        'Clients must use **exponential backoff with full jitter** and a cap, and the gateway should rate-limit accepts (token bucket on new connections) and shed with `1013 Try Again Later` rather than collapse. Resume tokens and cached auth make each reconnect cheaper.',
      ],
      diagram: {
        type: 'flow',
        title: 'Graceful gateway drain',
        nodes: [
          { label: 'Fail LB health', sub: 'no new conns', tone: 'warn' },
          { label: 'Close 2% / 10 s', sub: 'code 1012 + jitter hint', tone: 'accent' },
          { label: 'Clients reconnect', sub: 'backoff + full jitter' },
          { label: 'Land elsewhere', sub: 'least-connections', tone: 'info' },
          { label: 'Resume cursor', sub: 'no lost messages', tone: 'ok' },
          { label: 'Exit', sub: 'after last conn' },
        ],
      },
      code: {
        lang: 'text',
        caption: 'Client reconnect with full jitter',
        code: `attempt = 0
on close:
  base = min(30s, 500ms * 2^attempt)
  sleep(random(0, base))          # full jitter
  attempt += 1
  connect(resume_token, last_seq)
on open: attempt = 0`,
      },
      insight: 'Long-lived connections defeat load balancing: after scale-out, new nodes sit empty while old ones stay full. Periodic randomized connection recycling (e.g. close after 1–4 h with jitter) keeps the fleet balanced and makes drains routine instead of scary.',
    },
    {
      title: 'Choosing the transport',
      hook: 'WebSocket is the default reflex, but SSE or push notifications are often the better tool.',
      body: [
        '**SSE** (`text/event-stream`) is one long HTTP response: server→client only, built-in browser reconnect with `Last-Event-ID`, works through most proxies and over HTTP/2 multiplexing (on HTTP/1.1 browsers allow only ~6 connections per origin, which SSE tabs exhaust). It fits notifications, feeds, progress and LLM token streams.',
        '**WebSocket** is full-duplex and best when clients also send frequently (chat input, cursors, games). **Long polling** is the universal fallback through hostile proxies. **WebTransport** (HTTP/3/QUIC) adds multiple streams and unreliable datagrams without head-of-line blocking, but browser support is still uneven. On mobile, the OS suspends background sockets: use **APNs/FCM** push to wake the app, then sync.',
      ],
      table: {
        columns: ['Transport', 'Direction', 'Reconnect/resume', 'Infra friction', 'Best for'],
        rows: [
          ['Short polling', 'pull', 'trivial', 'none', 'rare updates, small scale'],
          ['Long polling', 'pull (held)', 'manual cursor', 'low', 'fallback, restrictive networks'],
          ['SSE', 'server → client', 'built-in Last-Event-ID', 'low (plain HTTP)', 'feeds, notifications, streams'],
          ['WebSocket', 'bidirectional', 'manual cursor', 'Upgrade + idle timeouts', 'chat, collab, games'],
          ['WebTransport', 'bidi + datagrams', 'manual', 'HTTP/3, uneven support', 'low-latency media/games'],
          ['APNs / FCM', 'server → device', 'OS-managed', 'vendor dependency', 'backgrounded mobile apps'],
        ],
      },
      insight: 'Mobile apps need both: a socket while foregrounded and push when backgrounded. The registry decides — no live connection for the device means send a push.',
    },
  ],

  scaling: {
    body: [
      'Gateways scale horizontally, but they are stateful in memory, so the scaling story is about the **edges of a node’s life**: balancing new connections (least-connections, since round-robin ignores long-lived load), draining old ones, and rebalancing after scale-out via connection recycling. Size nodes by connections and by fan-out bandwidth, not by request rate.',
      'Control plane vs data plane: the registry and backplane are shared dependencies. If Redis Pub/Sub hiccups, delivery degrades to resume-on-next-sync; if the registry is down, 1:1 routing fails but room-topic routing can continue. Shard both (by user id / room id) so a single shard failure is partial.',
      'Multi-region: clients connect to the nearest region (GeoDNS/anycast). Users in one room may be in different regions, so room events must cross regions — via a global bus, regional channel servers that replicate, or by homing each room in one region and accepting WAN latency for remote members. Presence across regions is eventually consistent by design.',
    ],
    bullets: [
      'Least-connections balancing for new sockets; periodic jittered recycling for rebalancing.',
      'Cap connections per node (e.g. 100k–500k) to bound blast radius and drain time.',
      'Accept-rate limiting and `1013 Try Again Later` to survive reconnect storms.',
      'Shard registry and backplane by user/room id; avoid a single Redis for everything.',
      'Separate pools for different client types (mobile, web, bots) so one cannot starve another.',
      'Deploy by draining in waves, one AZ at a time, with the client backoff verified in staging.',
    ],
    diagram: {
      type: 'layers',
      title: 'Multi-region realtime',
      layers: [
        { name: 'Global', items: ['GeoDNS / anycast', 'Room home region map', 'Cross-region bus'], tone: 'info' },
        { name: 'Region A', items: ['LB', 'Gateways', 'Registry shard', 'Channel servers'], tone: 'accent' },
        { name: 'Region B', items: ['LB', 'Gateways', 'Registry shard', 'Channel servers'], tone: 'accent' },
        { name: 'Durable', items: ['Message store (replicated)', 'Cursors', 'Push gateway'], tone: 'ok' },
      ],
    },
  },

  failures: [
    {
      name: 'Reconnect storm',
      symptom: 'After a deploy or node crash, auth and registry latency spike, connects fail, clients retry in waves.',
      detect: 'New connections/s per node and fleet-wide; `101` vs `5xx` handshake ratio; auth service p99; Redis ops/s spike.',
      mitigate: 'Gradual drain, full-jitter backoff in clients, accept-rate limiting, resume tokens to skip expensive re-auth.',
    },
    {
      name: 'Silent drops by an idle timeout',
      symptom: 'Users stop receiving messages after ~60 s of quiet; reconnect cycles every minute.',
      detect: 'Histogram of connection lifetimes clustering at the LB idle timeout; close code 1006 rates.',
      mitigate: 'Heartbeat interval < smallest idle timeout on the path; raise ALB/nginx idle timeouts.',
    },
    {
      name: 'Slow consumers exhaust memory',
      symptom: 'Gateway RSS grows during busy events, then OOM-kill disconnects everyone on the node.',
      detect: 'Per-connection send-queue depth p99, dropped-frame and slow-close counters, RSS per connection.',
      mitigate: 'Bounded queues, write deadlines, drop ephemeral events first, disconnect and resync.',
    },
    {
      name: 'Stale registry → lost delivery',
      symptom: 'Messages routed to a node that no longer has the user; user sees them only after reload.',
      detect: 'Rate of publishes to nodes with no matching local socket; client-reported gaps in sequence numbers.',
      mitigate: 'TTL + epoch compare-and-delete, client acks by seq, resume from cursor on every reconnect.',
    },
    {
      name: 'Fan-out hotspot',
      symptom: 'A celebrity room or broadcast saturates bus bandwidth and the nodes hosting most members.',
      detect: 'Bus messages/s per topic, egress bytes per node, event-loop lag.',
      mitigate: 'Room-topic routing, serialize once, relay tiers, coalesce/sampling of presence and typing.',
    },
    {
      name: 'Imbalance after scale-out',
      symptom: 'New nodes idle, old nodes near limits; adding capacity does not help.',
      detect: 'Connections per node spread (max/min), CPU skew across fleet.',
      mitigate: 'Least-connections, max-connection-age recycling with jitter, admission caps per node.',
    },
  ],

  warStories: [
    {
      title: 'Slack’s first Monday of 2021',
      source: 'Slack Engineering, "Slack’s Outage on January 4th 2021"',
      what: 'On the first working day after the holidays, clients reconnecting and booting at once drove a sharp traffic rise. Packet loss inside AWS Transit Gateways, which had not scaled for the spike, made requests slow and fail; retries and autoscaling added load, and the provisioning service that brings up new servers itself struggled under the burst.',
      lesson: 'Realtime products have synchronized load (Monday morning, post-outage reconnect). Capacity-plan for the reconnect peak, not the steady state, and make retries and scale-ups degrade gracefully.',
    },
    {
      title: 'One million users in one Discord server',
      source: 'Discord Engineering, "Maxjourney" (2023)',
      what: 'Midjourney’s server grew past a million online members; a single guild process fanning every event out to every session could not keep up. Discord split fan-out into relays, introduced passive sessions that receive less traffic, and optimized member-list handling.',
      lesson: 'Fan-out cost is members × event rate; at the extreme you must change what you send (lazy, passive, sampled) as well as how you send it.',
    },
    {
      title: 'Deploy-triggered reconnect storm',
      source: 'Composite of common incidents',
      what: 'A team rolled a gateway deploy with Kubernetes defaults: pods killed after 30 s, 25% at a time. Each wave dumped ~400k clients on the remaining nodes; clients reconnected with fixed 1 s retries, the auth service hit its connection pool limit, handshakes failed and clients retried in lockstep for 20 minutes.',
      lesson: 'Long grace periods, batch draining, full-jitter backoff and accept-rate limits are not optimizations; they are what makes deploys safe.',
    },
  ],

  numbers: [
    { label: 'Connections per tuned box', value: '1–2M', note: 'WhatsApp 2M+ (2012), Phoenix 2M (2015)' },
    { label: 'Memory per idle connection', value: '~10–50 KB', note: 'more with TLS buffers / compression' },
    { label: 'permessage-deflate state', value: '~300 KB/conn', note: 'with context takeover, default zlib' },
    { label: 'ALB idle timeout', value: '60 s default', note: 'configurable 1–4,000 s' },
    { label: 'nginx proxy_read_timeout', value: '60 s default' },
    { label: 'Heartbeat interval', value: '20–45 s', note: 'below every idle timer on the path' },
    { label: 'Ephemeral ports (Linux default)', value: '~28k', note: '32768–60999 per dest IP:port, dialing side only' },
    { label: 'HTTP/1.1 conns per origin (browser)', value: '~6', note: 'limits SSE tabs; HTTP/2 multiplexes' },
    { label: 'Fan-out', value: 'online members × msg rate', note: '100k × 5/s = 500k writes/s' },
    { label: 'Typical push latency', value: '< 100 ms', note: 'publish → frame on client, same region' },
  ],

  capacity: {
    question: 'A chat app has 20M daily users, 5M concurrent at peak, each receiving ~1 message/min and sending a heartbeat every 30 s. How many gateway nodes and how much backplane traffic?',
    steps: [
      'Connections: 5M concurrent; cap 250k per node for blast radius ⇒ 20 nodes, +50% headroom for drains and AZ loss ⇒ 30 nodes.',
      'Memory: 250k × ~40 KB ≈ 10 GB per node for connections; 32 GB instances leave room for queues and spikes.',
      'Heartbeats: 5M ÷ 30 s ≈ 167k pings/s fleet-wide (~5.6k per node) plus registry TTL refreshes (~167k Redis ops/s ⇒ shard Redis, or refresh every 2nd heartbeat).',
      'Messages: 5M × 1/min ≈ 83k deliveries/s; with room-topic routing the bus carries one copy per (room, node) — far fewer than deliveries.',
      'Reconnect storm: losing one node ⇒ 250k reconnects; at an accept limit of 5k/s per node across 29 nodes ≈ 2 s to absorb; auth must handle ~145k validations/s burst or use resume tokens.',
    ],
    answer: '~30 gateway nodes (32 GB each), a sharded Redis registry handling ~170k ops/s, a room-topic backplane, and reconnect handling sized for ~250k connects within seconds.',
  },

  comparison: {
    caption: 'Ways to run realtime delivery',
    columns: ['Option', 'Model', 'Scale story', 'Ops burden', 'Pick when'],
    rows: [
      ['Self-built (Go/Netty/Rust)', 'WS + Redis/NATS backplane', 'Millions, you tune everything', 'High', 'Core product is realtime, cost matters'],
      ['Elixir Phoenix Channels', 'BEAM processes + PubSub', '1–2M per node, distributed', 'Medium', 'Team knows Elixir; rooms/topics'],
      ['Socket.IO (Node)', 'WS + fallbacks + Redis adapter', 'Moderate; adapter is bottleneck', 'Medium', 'Fast to build, small–mid scale'],
      ['AWS API Gateway WebSocket', 'Managed sockets + HTTP push', 'Managed; per-msg pricing', 'Low', 'Spiky, modest volume'],
      ['Ably / Pusher', 'Hosted pub/sub channels', 'Provider scales', 'Lowest', 'Realtime is a feature, not the product'],
      ['SSE behind normal HTTP stack', 'One-way stream', 'Same as long requests', 'Low', 'Server → client only'],
    ],
  },

  whenNot: [
    'Data changes rarely or freshness of tens of seconds is fine — conditional polling with `ETag` or a CDN-cached endpoint is simpler.',
    'Updates flow only server → client (notifications, feeds, token streams) — SSE uses plain HTTP and auto-reconnects.',
    'Mobile apps in the background — use APNs/FCM; the OS will kill your socket.',
    'Server-to-server event delivery — webhooks or a message broker, not WebSockets.',
    'Small internal tools with a handful of users — a managed service or polling beats operating a stateful fleet.',
  ],

  interview: [
    {
      q: 'Design message delivery for a chat app where the sender and recipient are on different gateway nodes.',
      a: 'The sender’s gateway forwards the message to the chat service, which persists it with a per-conversation sequence number first. It then routes via the backplane: for 1:1, look up the recipient’s devices in the registry and publish to those nodes; for groups, publish to the room topic that nodes with members subscribe to. The owning gateway writes the frame; the client acks by sequence. If the recipient is offline, send a push; on reconnect, the client resumes from its last acked sequence.',
      followUps: ['What if Redis Pub/Sub drops the message?', 'How do you handle a user with three devices?', 'How do you guarantee ordering within a conversation?'],
      seniorSignal: 'Persist-then-push with sequence-based resume, so the realtime path can be lossy without losing messages.',
    },
    {
      q: 'How do you deploy a new version of a gateway fleet holding 5M connections?',
      a: 'Drain node by node (or AZ by AZ): fail the LB health check, close existing connections in small batches over minutes with code 1012 and a jittered reconnect hint, wait for them to land elsewhere, then terminate. Clients use exponential backoff with full jitter and resume tokens; gateways rate-limit accepts and shed with 1013 if overloaded. Kubernetes needs a long termination grace period and a preStop hook. Watch connects/s, auth p99 and handshake errors as deploy gates.',
      followUps: ['How long does a full rollout take, and is that acceptable?', 'What if you need an emergency fix?', 'How do you rebalance after the deploy?'],
      seniorSignal: 'Quantifies reconnect rate vs dependency capacity and treats client backoff behaviour as part of the server deploy design.',
    },
    {
      q: 'How many WebSocket connections can one server hold, and what limits it?',
      a: 'Idle connections are limited by memory and file descriptors, not CPU: roughly 10–50 KB each depending on kernel buffers, TLS state and the runtime, so 1M connections need tens of GB. You raise fd limits, keep socket buffers small, use an event loop, and avoid per-connection compression contexts. The practical ceiling is usually chosen lower — fan-out bandwidth, event-loop lag and blast radius on failure matter more than the theoretical maximum.',
      followUps: ['Where do ephemeral port limits actually apply?', 'What does permessage-deflate do to memory?'],
      seniorSignal: 'Separates per-connection memory accounting from operational limits like blast radius and reconnect time.',
    },
    {
      q: 'Users on some networks get disconnected every minute. What is going on?',
      a: 'Almost certainly an idle timeout on a hop shorter than the heartbeat interval — an ALB at its 60 s default, an nginx `proxy_read_timeout` of 60 s, a corporate proxy, or a mobile NAT. Confirm with a histogram of connection lifetimes and close codes (1006 = abnormal). Fix by sending heartbeats more often than the smallest timeout and raising LB/proxy timeouts; also ensure the client detects dead connections via app-level heartbeats.',
      followUps: ['Why can’t the browser see ping/pong frames?', 'How do you detect a half-open connection?'],
      seniorSignal: 'Goes straight to timer mismatches along the path and proves it with lifetime histograms.',
    },
    {
      q: 'A room has 200k online members. How do you deliver a message and presence updates?',
      a: 'Publish once to the room topic; each gateway with members receives one copy, serializes the frame once and writes it to its local sockets. For very large rooms, add relay processes to split the fan-out and send less to inactive viewers. Presence is the real danger — naive updates are O(N²) — so coalesce presence changes, only send presence for members visible in the client’s list, and drop typing indicators under load.',
      followUps: ['What happens to fan-out during a reconnect storm?', 'How do you prioritize chat messages over presence?'],
      seniorSignal: 'Recognizes presence as the quadratic amplifier and changes what is sent, not only how.',
    },
    {
      q: 'WebSocket, SSE, long polling or push notifications — how do you choose?',
      a: 'If updates are one-way server→client (notifications, dashboards, AI token streams), SSE is simpler: plain HTTP, built-in reconnect with Last-Event-ID, works over HTTP/2. WebSocket when clients send frequent low-latency messages (chat input, collaboration cursors, games). Long polling as a fallback for restrictive networks. Mobile apps need APNs/FCM when backgrounded. Plain polling remains right for rare, cacheable updates.',
      followUps: ['What is the HTTP/1.1 connection-per-origin problem with SSE?', 'When would WebTransport be worth it?'],
      seniorSignal: 'Chooses by direction, frequency and client environment rather than defaulting to WebSocket.',
    },
  ],

  takeaways: [
    'A gateway is a thin stateful edge: auth on connect, registry, backplane routing, backpressure — no business logic.',
    'Persist first, push second, resume by sequence: the socket is a delivery hint, the log is the truth.',
    'Idle connections cost memory and fds, not CPU; watch TLS and compression state per connection.',
    'Heartbeats must beat every idle timer on the path (ALB 60 s, nginx 60 s, mobile NATs).',
    'Bound every per-connection queue; drop ephemeral events first, then disconnect and resync.',
    'Deploys and outages cause reconnect storms: drain slowly, full-jitter backoff, accept-rate limits.',
    'Fan-out via room topics, serialize once; presence is the O(N²) trap.',
    'SSE for one-way, WebSocket for bidirectional, push for background mobile, polling for rare updates.',
  ],
};

export default deep;
