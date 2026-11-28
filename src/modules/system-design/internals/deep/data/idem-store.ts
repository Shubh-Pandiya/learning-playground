import type { Deep } from '../../types';

const deep: Deep = {
  kind: 'idem-store',

  // ───────────────────────────── 1. PROBLEM ─────────────────────────────
  problem: {
    why:
      'Networks give you at-least-once at best. A client that times out cannot know whether the server never received the request, executed it and crashed, or executed it and lost the response — so the only safe client behaviour is to **retry**. For a non-idempotent operation (charge a card, create an order, send a payout) the server must therefore make a retry observably identical to the first execution. An idempotency key store does that by naming the logical operation, **claiming** it atomically, and **remembering its outcome**.',
    withoutIt: [
      'Double charges and duplicate orders whenever a client, SDK, gateway or mesh retries after a timeout.',
      'Clients must choose between “maybe lost” (do not retry) and “maybe duplicated” (retry) — there is no correct choice.',
      'Redelivered queue messages (SQS, Kafka and friends are at-least-once) send two emails, decrement inventory twice, pay out twice.',
      'A double-click or two app instances submitting concurrently race into two executions.',
      'Reconciliation and refunds become an operational process, discovered days later in the ledger.',
    ],
    position:
      'Inside the service that owns the side effect, after authentication and request validation and before any mutation. Usually a table in the same database as the business data (or a DynamoDB/Redis table), keyed by `(account, idempotency_key)`.',
    diagram: {
      type: 'sequence',
      title: 'The lost-response problem and its fix',
      actors: ['Client', 'API', 'Key store', 'Processor'],
      messages: [
        { from: 'Client', to: 'API', label: 'POST /charges, Key: K' },
        { from: 'API', to: 'Key store', label: 'claim K (insert-if-absent)' },
        { from: 'API', to: 'Processor', label: 'charge $50 (key K)' },
        { from: 'API', to: 'Key store', label: 'save 201 + body for K' },
        { from: 'API', to: 'Client', label: '201 … lost in network', dashed: true, tone: 'bad' },
        { from: 'Client', to: 'API', label: 'retry POST, Key: K' },
        { from: 'API', to: 'Key store', label: 'K exists, completed' },
        { from: 'API', to: 'Client', label: 'replay stored 201', dashed: true, tone: 'ok' },
      ],
      caption: 'One charge, two requests. The key names the operation, not the HTTP attempt.',
    },
  },

  // ───────────────────────────── 2. ARCHITECTURE ─────────────────────────────
  architecture: {
    overview:
      'The store is a small table: `(account, key) → request fingerprint, state, recovery point, lock, stored response, created_at`. Around it sit four mechanisms: an **atomic claim** (unique constraint or `SET NX`) so exactly one request owns the operation, a **fingerprint** check so a key cannot be reused for a different request, **atomic phases** so local effects and key state commit together with resumable recovery points between external calls, and a **reaper** that finishes or expires old keys.',
    diagram: {
      type: 'flow',
      title: 'Request path through an idempotency layer',
      nodes: [
        { label: 'Key + scope', sub: 'account, Idempotency-Key', tone: 'neutral' },
        { label: 'Fingerprint', sub: 'hash of method, path, body', tone: 'info' },
        { label: 'Atomic claim', sub: 'INSERT … ON CONFLICT', tone: 'violet' },
        { label: 'Atomic phases', sub: 'tx per recovery point', tone: 'accent' },
        { label: 'Store response', sub: 'code + body, finished', tone: 'ok' },
        { label: 'Replay / 409 / 422', sub: 'for every later attempt', tone: 'warn' },
      ],
      caption: 'A losing claim never executes anything: it replays, waits (409) or rejects a mismatched reuse (422).',
    },
    blocks: [
      {
        name: 'Key and scope',
        what: 'Client-generated, high-entropy key (UUIDv4, or ULID) per **logical operation**, persisted client-side before the first attempt. Scoped by account (and often endpoint) so keys from different tenants cannot collide. Stripe accepts keys up to 255 characters.',
      },
      {
        name: 'Request fingerprint',
        what: '`sha256(method, path, canonical body)` stored with the key. A retry with the same key and a different fingerprint is a client bug: reject (`422` in the IETF draft) instead of replaying an unrelated response.',
      },
      {
        name: 'Atomic claim primitive',
        what: 'Unique index plus `INSERT … ON CONFLICT DO NOTHING RETURNING`, Redis `SET key owner NX PX ttl`, or DynamoDB `PutItem` with `attribute_not_exists(pk)`. Exactly one concurrent request gets “inserted”; there is no separate check step.',
      },
      {
        name: 'Recovery point + lock',
        what: 'A `recovery_point` column (`started`, `order_created`, `charge_created`, `finished`) and `locked_at`. The holder of a fresh lock executes; a retry after the lock times out resumes from the last recorded recovery point instead of starting over.',
      },
      {
        name: 'Stored response',
        what: 'HTTP status, body and selected headers of the first completed execution, replayed byte-for-byte. Deterministic errors are stored too, so the client sees the same outcome on every retry.',
      },
      {
        name: 'Transactional outbox',
        what: 'Follow-up side effects (receipt email, events) are written as rows in the same transaction as the business change and the key update, then delivered by a separate worker — never fired directly from the request.',
      },
      {
        name: 'Reaper / completer',
        what: 'Background jobs that push abandoned keys to completion (or roll them back) and delete keys past their TTL — ideally by dropping time partitions rather than row-by-row `DELETE`.',
      },
    ],
    real: [
      {
        name: 'Stripe API',
        how: '`Idempotency-Key` header on all POSTs. Stripe saves the status code and body of the first request once the endpoint starts executing — including `500`s — and replays it for the same key. Parameters are compared with the original and a mismatch errors. Requests that fail validation or collide with a concurrently running request with the same key are not saved and can be retried. Keys can be pruned once at least 24 hours old.',
      },
      {
        name: 'Postgres pattern (Brandur Leach, “Implementing Stripe-like Idempotency Keys in Postgres”)',
        how: 'An `idempotency_keys` table with a unique index on `(user_id, idempotency_key)`, `locked_at`, request params and `recovery_point`. Work is split into **atomic phases**, each a `SERIALIZABLE` transaction that also advances the recovery point; foreign calls sit between phases and are themselves idempotent. A completer finishes stalled keys and a reaper deletes old ones.',
      },
      {
        name: 'AWS Lambda Powertools Idempotency',
        how: 'A DynamoDB table keyed by a hash of the event (or a JMESPath-selected part). A conditional `PutItem` writes `INPROGRESS` only if the key is absent or expired; on success the result is stored as `COMPLETED`; duplicates get the stored result or an “already in progress” error. Default record expiry is 1 hour; payload validation can reject reused keys with a different payload.',
      },
      {
        name: 'Kafka idempotent producer',
        how: 'The broker assigns a producer id; each batch carries a per-partition sequence number and the broker drops duplicates from producer retries. Enabled by default since Kafka 3.0 (requires `acks=all`, `max.in.flight.requests.per.connection ≤ 5`). It removes duplicates caused by the producer’s own retries within a session — not duplicates from your application calling `send()` twice.',
      },
      {
        name: 'Amazon SQS FIFO deduplication',
        how: 'A `MessageDeduplicationId` (or a SHA-256 of the body with content-based dedup) suppresses duplicate sends within a **5-minute** deduplication interval. Useful for producer retries; consumers still need their own dedup because visibility-timeout redelivery is at-least-once.',
      },
    ],
  },

  // ───────────────────────────── 3. LIFECYCLE ─────────────────────────────
  lifecycle: {
    summary:
      'A first-time `POST /v1/charges` with a Postgres-backed key table. The idempotency layer adds two small transactions (~3 ms) around an external call that dominates the latency; a replayed retry costs one indexed read.',
    stages: [
      { stage: 'Extract and scope key', what: 'Read `Idempotency-Key`, validate length/format, scope it with the authenticated account id.', cost: 'Header parse', ms: 0.01, part: 'header' },
      { stage: 'Fingerprint request', what: '`sha256` over method, path and canonicalised JSON body (~2 KB).', cost: 'A few µs of hashing', ms: 0.01, part: 'fingerprint' },
      { stage: 'Atomic claim', what: '`INSERT … ON CONFLICT DO NOTHING RETURNING` in its own short transaction with `locked_at = now()`; commit.', cost: '1 RTT + index insert + WAL fsync', ms: 1.5, part: 'claim' },
      { stage: 'Phase 1: local writes', what: 'Create the charge row in `pending`, advance `recovery_point = charge_created` — one transaction.', cost: '1 transaction', ms: 2, part: 'execute' },
      { stage: 'Foreign call', what: 'Call the card processor, forwarding a key derived from K so the processor deduplicates as well.', cost: 'External API', ms: 300, part: 'execute' },
      { stage: 'Phase 2: finish', what: 'Store processor id, set charge `succeeded`, insert outbox row for the receipt, store `201` + body, `recovery_point = finished` — one transaction.', cost: '1 transaction', ms: 2, part: 'record' },
      { stage: 'Replay on retry', what: 'Claim returns 0 rows; `SELECT` by primary key, fingerprint matches, state finished → return stored response.', cost: '1 indexed read', ms: 0.6, part: 'replay' },
    ],
  },

  // ───────────────────────────── 4. DEEP DIVES ─────────────────────────────
  deepDives: [
    {
      title: 'The atomic claim: why check-then-act fails',
      hook: 'Two concurrent retries both see “absent” unless the check and the write are one operation.',
      body: [
        '`SELECT … WHERE key = K` followed by `INSERT` is a race: two requests arriving within a millisecond both see no row and both execute. The check and the claim must be **one** atomic operation whose failure tells you that you lost: a unique constraint (`ON CONFLICT DO NOTHING` returning zero rows), Redis `SET NX`, or a DynamoDB condition expression.',
        'In Postgres under READ COMMITTED, a second `INSERT` on the same unique key **blocks** until the first transaction commits or aborts, then does nothing. So commit the claim in its own short transaction: if you hold it inside a long transaction around an external call, concurrent duplicates hang on the index instead of getting a fast `409`.',
        'The loser reads the row and decides: fingerprint differs → `422`; still locked by a live owner → `409 Conflict` (retry later); finished → replay; lock expired → take over and resume from the recovery point.',
      ],
      diagram: {
        type: 'sequence',
        title: 'Two concurrent requests with the same key',
        actors: ['Request A', 'Request B', 'Postgres'],
        messages: [
          { from: 'Request A', to: 'Postgres', label: 'INSERT K … ON CONFLICT DO NOTHING' },
          { from: 'Postgres', to: 'Request A', label: '1 row: you own K', dashed: true, tone: 'ok' },
          { from: 'Request B', to: 'Postgres', label: 'INSERT K … ON CONFLICT DO NOTHING' },
          { from: 'Postgres', to: 'Request B', label: '0 rows: K exists', dashed: true, tone: 'warn' },
          { from: 'Request B', to: 'Postgres', label: 'SELECT state, locked_at, hash' },
          { from: 'Postgres', to: 'Request B', label: 'started, locked 40 ms ago', dashed: true },
          { from: 'Request A', to: 'Postgres', label: 'phases commit, finished', tone: 'ok' },
        ],
        caption: 'Request B answers 409 immediately; its client retries later and gets A’s stored response.',
      },
      code: {
        lang: 'sql',
        caption: 'Key table and the claim. Zero rows returned means someone else owns K.',
        code: `CREATE TABLE idempotency_keys (
  account_id     bigint      NOT NULL,
  key            text        NOT NULL CHECK (length(key) <= 255),
  request_hash   bytea       NOT NULL,
  recovery_point text        NOT NULL DEFAULT 'started',
  locked_at      timestamptz,
  response_code  int,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);

INSERT INTO idempotency_keys (account_id, key, request_hash, locked_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (account_id, key) DO NOTHING
RETURNING recovery_point;

-- Redis equivalent:  SET idem:{acct}:K <owner-id> NX PX 86400000
-- DynamoDB:          PutItem ... ConditionExpression: attribute_not_exists(pk)`,
      },
      insight:
        'A unique constraint is the cheapest distributed lock you will ever have: it is durable, transactional with your data, and needs no lease renewal. Reach for Redis locks only when the side effect is not in that database anyway.',
    },
    {
      title: 'Fingerprints and response semantics',
      hook: 'What a retry sees must be deterministic, documented and the same every time.',
      body: [
        'The IETF `draft-ietf-httpapi-idempotency-key-header` codifies the common semantics: missing key on an endpoint that requires one → `400`; key reused with a different payload → `422`; a request with the same key is still being processed → `409`. Stripe behaves the same way in spirit.',
        'Canonicalise before hashing: JSON key order, whitespace, number formatting and defaulted fields must not change the fingerprint, or legitimate retries from a new SDK version are rejected. Many implementations hash only the semantically relevant parameters.',
        'Decide what is stored. Stripe stores any result once execution has begun, **including 500s**, so a retry after a server bug gets the same 500 and the client must use a new key to try again — determinism over convenience. Others treat 5xx as “release the key” so a retry re-executes; that is only safe if every step is resumable.',
      ],
      table: {
        caption: 'What the second attempt gets',
        columns: ['State of key K', 'Same fingerprint', 'Different fingerprint'],
        rows: [
          ['Absent', 'Claim and execute', 'Claim and execute'],
          ['Started, lock fresh', '409 Conflict, retry later', '422'],
          ['Started, lock expired', 'Take over, resume from recovery point', '422'],
          ['Finished (2xx or stored 4xx/5xx)', 'Replay stored response', '422'],
          ['Expired by TTL', 'Executes again (danger zone)', 'Executes again'],
        ],
      },
      insight:
        'Validation errors should be returned **before** the claim so a client that fixes its input can retry with the same key; only results produced after execution began belong in the store.',
    },
    {
      title: 'Atomic phases and recovery points',
      hook: 'You cannot roll back a card charge, so make every step resumable instead.',
      body: [
        'Local database work can be atomic; **foreign state mutations** (a card network, an email provider, another team’s API) cannot join your transaction. Brandur’s pattern splits the request into **atomic phases**: each phase is one local transaction that does its writes and advances `recovery_point` in the same commit.',
        'Foreign calls sit **between** phases and must themselves be idempotent — forward a key derived from yours so the provider deduplicates. If the process dies after the external call but before the next phase commits, a retry (after the lock times out) or the completer replays the external call with the same key and gets the same result.',
        'Anything that should happen after success — a receipt email, an event to Kafka — is written as a staged job/outbox row inside the final phase and delivered asynchronously, so it happens if and only if the operation committed.',
      ],
      diagram: {
        type: 'flow',
        title: 'Recovery points for “create ride + charge”',
        nodes: [
          { label: 'started', sub: 'key claimed', tone: 'neutral' },
          { label: 'ride_created', sub: 'tx: ride row + rp', tone: 'info' },
          { label: 'charge (foreign)', sub: 'idempotent, key forwarded', tone: 'warn' },
          { label: 'charge_created', sub: 'tx: charge id + rp', tone: 'info' },
          { label: 'finished', sub: 'tx: outbox + response', tone: 'ok' },
        ],
        caption: 'A crash anywhere resumes from the last committed recovery point; the only repeated step is an idempotent foreign call.',
      },
      code: {
        lang: 'python',
        caption: 'Resumable handler (simplified from the Rocket Rides example).',
        code: `def run(k):                                   # k = locked key row
    while True:
        if k.recovery_point == 'started':
            with tx(isolation='serializable'):
                ride = insert_ride(k.account_id, k.params)
                k.advance('ride_created')
        elif k.recovery_point == 'ride_created':
            ch = processor.charge(amount=..., idempotency_key=f'{k.key}:charge')
            with tx(isolation='serializable'):
                set_ride_charge(k.account_id, ch.id)
                k.advance('charge_created')
        elif k.recovery_point == 'charge_created':
            with tx(isolation='serializable'):
                stage_job('send_receipt', ride_id=...)   # outbox row
                k.finish(201, render_ride(...))
        else:                                   # 'finished'
            return k.response_code, k.response_body`,
      },
      insight:
        'The key store makes **your** side idempotent, not your providers’. Every foreign call needs either its own idempotency key or a recovery point before it — otherwise the gap between “provider did it” and “we recorded it” is a duplicate waiting for a crash.',
    },
    {
      title: '“Exactly once” = at-least-once delivery + idempotent processing',
      hook: 'No broker gives you exactly-once side effects in your database.',
      body: [
        'Queues redeliver: a consumer that crashes between doing the work and acking will see the message again. The robust consumer pattern is an **inbox** (processed-message table): insert the message id under a unique constraint in the **same transaction** as the side effect, then ack. A redelivery hits the constraint and is skipped.',
        'Broker-side features remove some duplicates but not all. Kafka’s idempotent producer stops duplicates from producer retries; Kafka transactions give exactly-once **within Kafka** for read-process-write pipelines; SQS FIFO drops duplicate sends within 5 minutes. None of them can make an external effect — a DB update in your service, an email — happen once; that is the consumer’s job.',
      ],
      diagram: {
        type: 'compare',
        title: 'Who removes which duplicates',
        columns: [
          { name: 'Producer / broker', points: ['Kafka PID + sequence', 'SQS FIFO 5-min dedup id', 'fixes send retries only'], tone: 'info' },
          { name: 'Consumer inbox', points: ['unique (consumer, msg_id)', 'same tx as the effect', 'ack after commit'], tone: 'ok' },
          { name: 'API key store', points: ['client-chosen key', 'stored response replay', 'fixes client retries'], tone: 'violet' },
        ],
      },
      code: {
        lang: 'sql',
        caption: 'Inbox dedup inside the consumer’s transaction.',
        code: `BEGIN;
INSERT INTO inbox (consumer, message_id, received_at)
VALUES ('billing', $1, now())
ON CONFLICT DO NOTHING;               -- 0 rows => duplicate: ROLLBACK and ack
-- only if 1 row was inserted:
UPDATE accounts SET balance = balance - $2 WHERE id = $3;
COMMIT;                               -- then ack / commit the offset`,
      },
      insight:
        'The dedup horizon must exceed the **redelivery** horizon, including DLQ replays and topic re-consumption from an old offset, which can be days — far longer than an API key TTL.',
    },
    {
      title: 'Natural idempotency: make the operation itself safe',
      hook: 'The cheapest idempotency key is one you never have to store.',
      body: [
        'HTTP defines `PUT` and `DELETE` as idempotent (RFC 9110): setting a resource to a full representation twice has the same effect as once. Let clients choose resource ids (`PUT /orders/{client_uuid}`) and the primary key **is** the idempotency key. Replace “increment” with “set” where possible.',
        'Conditional writes make updates safe under retries and concurrency: `If-Match: <etag>` returning `412` on mismatch, `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2`, DynamoDB `ConditionExpression`, or deterministic ids derived from business keys (UUIDv5 of `invoice:2026-11:acct42`).',
      ],
      table: {
        caption: 'Techniques compared',
        columns: ['Technique', 'Example', 'Protects against', 'Limit'],
        rows: [
          ['Client-chosen id', '`PUT /orders/{uuid}`', 'Duplicate creates', 'Client must persist the id'],
          ['Set, not increment', '`status = shipped`', 'Replayed updates', 'Not for counters/balances'],
          ['Version check', '`WHERE version = $v`', 'Lost updates + replays', 'Retry needs fresh read'],
          ['Deterministic id', 'UUIDv5(business key)', 'Duplicate rows from replays', 'Needs a natural business key'],
          ['Key store', '`Idempotency-Key` header', 'Any non-idempotent POST', 'Storage, TTL, extra writes'],
        ],
      },
      insight:
        'Reserve the key store for operations with irreversible external effects or server-generated ids. Everywhere else, design the write to be naturally idempotent and skip the extra table.',
    },
    {
      title: 'The gaps: where duplicates still sneak in',
      hook: 'Every place where the key state and the side effect are not in one commit is a bug.',
      body: [
        'Crash after the claim, before any effect: the key is stuck in `started`. Without a lock timeout every retry gets `409` until the TTL; with one, a retry resumes safely.',
        'Effect done, key not updated: if the effect was local and in the same transaction, this cannot happen. If it was external and not idempotent downstream, a retry repeats it — the reason to forward keys to providers.',
        'Key in Redis, effect in Postgres: there is no shared transaction, and Redis replication is asynchronous, so a failover can forget the newest keys. Duplicates then depend on the downstream being idempotent on its own.',
        'Publishing an event after commit is a dual write: crash between commit and publish loses it; publish before commit can emit an event for a rolled-back change. Use the transactional outbox.',
      ],
      table: {
        caption: 'Crash point → what the retry sees → fix',
        columns: ['Crash point', 'Retry sees', 'Fix'],
        rows: [
          ['After claim, before effects', 'Stuck `started` → 409', 'Lock timeout + resume'],
          ['After external call, before record', 'Would call again', 'Forward key; provider dedups'],
          ['Redis failover after SET NX', 'Key missing → re-execute', 'Store keys in the primary DB'],
          ['After commit, before publish', 'Event never sent', 'Outbox row in the same tx'],
        ],
      },
      insight:
        'Draw the timeline of one request and mark every crash point; the design is correct only when each mark leads to “resume” or “replay”, never “re-execute”.',
    },
    {
      title: 'TTL and storage sizing',
      hook: 'A key that expires before the last retry is not an idempotency key.',
      body: [
        'TTL must exceed the longest realistic retry horizon: client backoff schedules, offline mobile queues that flush hours later, batch jobs re-run the next morning. Stripe keeps keys at least 24 h; Powertools defaults to 1 h for Lambda events; SQS FIFO dedups for only 5 minutes. Past the TTL, a retry is a new operation.',
        'Storage is `writes/day × row size × retention`. The response body dominates: storing a 2 KB JSON body per key costs ~10× the key metadata. Compress it, or store only the resource id and re-render the response on replay if that is deterministic.',
        'Expiry in Postgres via `DELETE … WHERE created_at < now() − interval` creates millions of dead tuples per day and vacuum pressure. Partition the table by day and **drop** old partitions instead.',
      ],
      insight:
        'For queue consumers and DLQ replays, the safe horizon is the broker’s retention, not the API’s TTL; keep inbox rows at least as long as messages can be replayed.',
    },
  ],

  // ───────────────────────────── 5. SCALING ─────────────────────────────
  scaling: {
    body: [
      'The key store scales with the data it protects: shard it by the **same key** as the business tables (usually account id) so the claim, the effects and the response record commit in one single-shard transaction. Keys are random, so there are no hot partitions unless one account dominates writes.',
      'Multi-region active-active is where idempotency quietly breaks. Two regions can each “claim” the same key if the store replicates asynchronously (DynamoDB global tables reconcile with last-writer-wins). Route each account (or each key) to a home region for writes, or use a strongly consistent single-region store for claims.',
      'Never check keys against an async read replica: replication lag makes a just-claimed key look absent. Claims and lookups go to the primary.',
    ],
    bullets: [
      'Cost per write: one extra insert and one extra update (or folded into existing phase transactions).',
      'Partition by day; drop partitions older than TTL + safety margin.',
      'Compress or omit large response bodies; store resource ids where re-rendering is deterministic.',
      'Redis-backed stores: AOF + replicas, and accept that failover can forget the newest keys.',
      'DynamoDB: conditional writes are strongly consistent per item in one region; global tables are not a lock.',
      'Expose key age and stuck-key counts as metrics; they are the early warning for crashes mid-operation.',
    ],
    diagram: {
      type: 'compare',
      title: 'Where to keep keys',
      columns: [
        { name: 'Same DB as data', points: ['claim + effect in one tx', 'durable as the data', 'shard by account'], tone: 'ok' },
        { name: 'Redis SET NX', points: ['~0.3 ms, TTL built in', 'no tx with the effect', 'failover can lose keys'], tone: 'warn' },
        { name: 'Global table', points: ['multi-region writes', 'async, last-writer-wins', 'two regions both claim'], tone: 'bad' },
      ],
    },
  },

  // ───────────────────────────── 6. FAILURES ─────────────────────────────
  failures: [
    {
      name: 'Check-then-act race',
      symptom: 'Two retries arrive together, both `SELECT` → absent, both charge the card.',
      detect: 'Reconciliation query: business rows grouped by idempotency key with `count(*) > 1`; zero unique-violation/conflict events despite known concurrent retries.',
      mitigate: 'Atomic insert-if-absent (unique constraint, `SET NX`, conditional put); remove the separate check.',
    },
    {
      name: 'Stuck in-progress keys',
      symptom: 'Clients get `409` for minutes or hours after a deploy or crash; operations never complete.',
      detect: 'Count of rows with `recovery_point <> \'finished\' AND locked_at < now() - interval \'5 minutes\'`; 409 rate per client.',
      mitigate: 'Lock timeout with resume from recovery point; completer job; alert on stuck-key age.',
    },
    {
      name: 'Fingerprint false mismatches',
      symptom: 'After an SDK release, legitimate retries get `422` because the body serialises differently.',
      detect: '422 “key reused with different parameters” rate spikes, correlated with client version.',
      mitigate: 'Canonical JSON before hashing; hash only semantic parameters; normalise defaults.',
    },
    {
      name: 'Key generated per attempt',
      symptom: 'Duplicates despite the store: the client creates a new UUID inside its retry loop.',
      detect: 'Duplicate business rows with **different** keys but identical fingerprints within seconds.',
      mitigate: 'Generate and persist the key once per logical operation; SDKs should own key generation.',
    },
    {
      name: 'Keys lost on Redis failover',
      symptom: 'A handful of duplicate notifications or payouts right after a Redis failover.',
      detect: 'Failover events (`role` change, `master_link_down_since_seconds`) correlated with duplicates in reconciliation.',
      mitigate: 'Keep keys in the primary database; or require downstream idempotency; `WAIT` for replica ack on critical claims.',
    },
    {
      name: 'TTL shorter than replay horizon',
      symptom: 'A DLQ replay three days later re-executes payouts whose keys expired after 24 h.',
      detect: 'Message age at processing time > key TTL; duplicates clustered after replays.',
      mitigate: 'Inbox retention ≥ broker retention; reject stale requests by timestamp; replays go through a dedicated path.',
    },
    {
      name: 'Table bloat from reaping',
      symptom: 'Key table and its index grow; write latency rises; autovacuum runs constantly.',
      detect: '`pg_stat_user_tables.n_dead_tup`, autovacuum duration, table/index size trends.',
      mitigate: 'Daily partitions and `DROP`/`DETACH` instead of `DELETE`; smaller stored bodies.',
    },
  ],

  warStories: [
    {
      title: 'Designing robust and predictable APIs with idempotency',
      source: 'Stripe blog (Brandur Leach, 2017) and Stripe API docs',
      what: 'Stripe explained why every mutating request takes an idempotency key: connections fail mid-request, and only a server-side record of the operation lets clients retry safely. Their client libraries generate keys automatically and retry with exponential backoff and jitter; the server stores the first result for at least 24 h, errors on parameter mismatch and refuses concurrent use of a key.',
      lesson: 'Idempotency is a contract between SDK and server: the SDK owns key generation and backoff, the server owns atomic claims and deterministic replay.',
    },
    {
      title: 'New key on every retry',
      source: 'Composite of common incidents',
      what: 'A mobile app wrapped `createOrder()` in a retry helper that built the request — including a fresh `Idempotency-Key` — inside the loop. On flaky networks some users got two or three orders. The server-side store worked perfectly; it never saw the same key twice.',
      lesson: 'Generate the key when the user expresses intent (tap “Pay”) and persist it with the pending operation; retries reuse it, even across app restarts.',
    },
    {
      title: 'Payouts replayed after the TTL',
      source: 'Composite of common incidents',
      what: 'A payout consumer deduplicated with Redis `SET NX` keys expiring after 24 h. A downstream outage parked thousands of messages in a DLQ; an engineer replayed them on day three. Keys had expired, and a fraction of payouts that had already succeeded before the outage were paid again.',
      lesson: 'Dedup horizons must cover the longest possible replay. Keep the inbox in the database with retention ≥ queue retention, and make replays idempotent by design.',
    },
  ],

  // ───────────────────────────── 7. NUMBERS ─────────────────────────────
  numbers: [
    { label: 'Stripe key retention', value: '≥ 24 h', note: 'keys up to 255 chars; first result incl. 500s is stored' },
    { label: 'Powertools idempotency expiry', value: '1 h default', note: 'DynamoDB conditional put, INPROGRESS / COMPLETED' },
    { label: 'SQS FIFO dedup interval', value: '5 minutes', note: 'MessageDeduplicationId or content hash' },
    { label: 'Kafka idempotent producer', value: 'in-flight ≤ 5, acks=all', note: 'default on since Kafka 3.0' },
    { label: 'IETF draft status codes', value: '400 / 409 / 422', note: 'missing key / in progress / payload mismatch' },
    { label: 'Claim cost (Postgres)', value: '~1–2 ms', note: 'one indexed insert + commit; replay ≈ one PK read' },
    { label: 'Redis SET NX', value: '~0.3 ms', note: 'but not transactional with your DB' },
    { label: 'UUIDv4 entropy', value: '122 bits', note: '10¹² keys ⇒ collision probability ~10⁻¹³' },
    { label: 'Row size', value: '~200 B + response body', note: 'body often 1–2 KB and dominates storage' },
  ],
  capacity: {
    question:
      'A payments API averages 600 POST/s (2,000/s peak), keeps keys 24 h and stores a 1.5 KB response per key. How much storage and write load does the idempotency layer add?',
    steps: [
      'Keys per day: 600 × 86,400 ≈ 52M.',
      'Row size: ~200 B metadata + 1.5 KB body + ~100 B index entry ≈ 1.8 KB ⇒ 52M × 1.8 KB ≈ 94 GB/day.',
      'With daily partitions you hold TTL + one day ≈ 2 days ≈ 190 GB; compressing bodies (~4×) or storing only the resource id cuts this to ~50 GB.',
      'Peak writes: 2,000 claims + 2,000 finishes (+ phase updates folded into existing transactions) ≈ 4,000–6,000 extra row writes/s.',
      'WAL: ~6,000 × 2 KB ≈ 12 MB/s extra at peak — notable for replication bandwidth, fine for a sharded Postgres cluster.',
    ],
    answer:
      'Roughly 100 GB/day of keys (≈ 25 GB compressed), ~190 GB resident with daily partitions, and ~5k extra writes/s at peak. Storage is dominated by response bodies; partition-drop expiry keeps it cheap.',
  },

  // ───────────────────────────── 8. COMPARISON ─────────────────────────────
  comparison: {
    caption: 'Ways to get idempotent processing',
    columns: ['Approach', 'Atomic with the effect?', 'Durability', 'Added latency', 'Best for'],
    rows: [
      ['Key table in the same SQL DB', 'Yes, same transaction', 'As durable as the data', '~1–2 ms', 'Payments, orders, any POST API'],
      ['Redis `SET NX PX`', 'No', 'Async replication; failover can lose keys', '~0.3 ms', 'High-volume dedup with idempotent downstream'],
      ['DynamoDB conditional put (Powertools)', 'Only via `TransactWriteItems`', 'Multi-AZ durable', 'Single-digit ms', 'Serverless handlers'],
      ['Consumer inbox table', 'Yes, same transaction', 'As durable as the data', '~1 ms', 'Queue and stream consumers'],
      ['Broker dedup (Kafka idem. producer, SQS FIFO)', 'n/a (transport only)', 'Broker-managed', '~0', 'Producer-retry duplicates only'],
      ['Natural idempotency (PUT, version check)', 'Inherent', 'As durable as the data', '0', 'Updates to state you own'],
    ],
  },
  whenNot: [
    'Naturally idempotent operations (full `PUT`, `DELETE`, set-state updates): use conditional writes or versions instead of an extra table.',
    'Reads (`GET`): no side effects to protect; storing responses only adds cost and staleness.',
    'When the client can choose the resource id (`PUT /orders/{uuid}`): the primary key already is the idempotency key.',
    'High-volume telemetry where rare duplicates are harmless or deduplicated downstream (approximate counters).',
    'Long-running multi-step workflows: a workflow engine (e.g. Temporal, which rejects starting a second run with a running workflow id) gives durable, resumable state for free.',
  ],

  // ───────────────────────────── 9. INTERVIEW ─────────────────────────────
  interview: [
    {
      q: 'Design a payment API that never double-charges when clients retry.',
      a: 'Require an Idempotency-Key per payment, generated once by the SDK. Validate the request, then atomically insert (account, key, request hash, started, locked_at) under a unique constraint in its own short transaction. The winner runs atomic phases with recovery points, forwards a derived key to the processor, and in the final transaction stores the response plus an outbox row. Retries replay the stored response, get 409 while in progress, 422 on parameter mismatch; keys expire after ≥ 24 h via partition drops.',
      followUps: ['What if two requests with the same key arrive at the same millisecond?', 'Where do you store keys if payments are in a sharded database?', 'What does the SDK need to do?'],
      seniorSignal: 'Covers the SDK side (key per intent), crash recovery and the external call, not just the table.',
    },
    {
      q: 'The server crashes after charging the card but before saving the response. What happens on retry?',
      a: 'The key is stuck in a recovery point before “charge recorded” with a stale lock. After the lock timeout, the retry (or a completer job) takes over and resumes from that recovery point, calling the processor again with the same derived idempotency key; the processor returns the original charge instead of creating a new one. The next phase records it and the response is stored. Without a forwarded key this crash point is an unavoidable double charge.',
      followUps: ['How long should the lock timeout be?', 'What if the provider has no idempotency support?', 'Who finishes keys whose clients never retry?'],
      seniorSignal: 'Identifies the foreign-call gap as the real risk and closes it with downstream idempotency plus recovery points.',
    },
    {
      q: 'Redis or the main database for idempotency keys?',
      a: 'If the side effect is a write to the main database, store keys there: the claim and the effect commit atomically, and durability matches the data. Redis `SET NX` is fast and has TTLs built in, but it cannot share a transaction with the effect and asynchronous replication can lose recent keys on failover. Redis fits high-volume deduplication where a rare duplicate is tolerable or the downstream is idempotent too.',
      followUps: ['Could you make Redis safe with `WAIT`?', 'What about DynamoDB conditional writes?'],
      seniorSignal: 'Frames the choice as “atomic with the effect or not” rather than as latency.',
    },
    {
      q: 'A vendor promises exactly-once delivery with Kafka. What do you actually get?',
      a: 'The idempotent producer removes duplicates caused by producer retries within a session, and transactions give atomic read-process-write within Kafka, so offsets and output records commit together. Effects outside Kafka — a database update or an email — are still at-least-once from the consumer’s point of view. You still need idempotent consumers: an inbox table in the same transaction as the effect, or naturally idempotent writes.',
      followUps: ['What happens when you re-consume from an old offset?', 'How long must inbox rows live?'],
      seniorSignal: 'Separates delivery semantics from effect semantics and puts the burden on the consumer.',
    },
    {
      q: 'Two identical requests arrive concurrently. Should the second get 409 or wait for the first?',
      a: 'Returning 409 is simple, never ties up server resources and tells the client to retry with backoff; waiting gives a nicer experience but holds a connection and needs a bounded wait. Many APIs return 409 immediately (Stripe, the IETF draft). Make sure the claim is committed in its own short transaction, otherwise Postgres blocks the second insert on the unique index and you get waiting by accident.',
      followUps: ['How does READ COMMITTED behave on a unique conflict?', 'How should the client handle 409?'],
      seniorSignal: 'Knows the database-level blocking behaviour that silently changes the API semantics.',
    },
    {
      q: 'How long do you keep keys, and what does it cost?',
      a: 'Longer than the longest retry horizon: client backoff, offline queues and replays. For a public payments API 24 h or more. Cost is writes/day × row size × retention, dominated by stored response bodies; e.g. 52M keys/day at ~1.8 KB is ~94 GB/day. Partition by day and drop partitions instead of deleting rows, and compress or slim response bodies.',
      followUps: ['What happens to a retry after expiry?', 'How would you handle a DLQ replay after 3 days?'],
      seniorSignal: 'Ties TTL to the replay horizon and anticipates Postgres bloat from delete-based expiry.',
    },
    {
      q: 'Should a stored 500 be replayed on retry?',
      a: 'It is a policy choice that must be documented. Stripe replays the stored result, including 500s, once execution has started — deterministic, but the client needs a new key to try again. The alternative releases the key on 5xx so a retry re-executes, which is only safe when every step is resumable or idempotent downstream. Validation failures and concurrency conflicts should never be stored.',
      followUps: ['Which errors are safe to release?', 'How does the client know to use a new key?'],
      seniorSignal: 'Explains the determinism vs convenience trade-off and its safety precondition.',
    },
  ],

  takeaways: [
    'Retries are mandatory over unreliable networks; idempotency is how the server makes them safe.',
    'The claim must be one atomic insert-if-absent — never check-then-act.',
    'Fingerprint the request: same key + different body is a 422, not a replay.',
    'Store keys in the same transaction as the effect; split external calls into atomic phases with recovery points and forwarded keys.',
    'Exactly-once effects = at-least-once delivery + idempotent consumers (inbox table).',
    'TTL must exceed the retry and replay horizon; partition and drop to expire cheaply.',
    'Prefer natural idempotency (client ids, set-not-increment, version checks) and reserve the key store for irreversible effects.',
  ],
};

export default deep;
