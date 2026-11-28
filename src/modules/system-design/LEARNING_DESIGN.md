# System Design Playground: learning design

The goal is to solve system-design problems you have never seen, not to memorise 20 diagrams.
Every mechanic below comes from learning research. The same list is shown in the app at `/system-design/method`
(source of truth: `PRINCIPLES` in `pages/Method.tsx`).

## The loop for each pattern

| Stage | Route | What you do | Why |
| --- | --- | --- | --- |
| **Learn** | `/system-design/p/:id/learn` | Step through a narrated build of the reference design. Failure and spike steps pause until you predict the outcome. | Worked example, generation effect |
| **Build** | `/system-design/p/:id/build` | Same scenario, no narration. Drag components, wire them, and watch the score and capabilities update. 3 hint levels. | Faded guidance, immediate feedback |
| **Challenge** | `/system-design/p/:id/challenge` | New domain with the same deep structure. 2 hints, and the "still missing" list is hidden. | Transfer, desirable difficulty |
| **Review** | `/system-design/review` | Interleaved recall questions across patterns, plus "name the pattern from the interview cue" drills, on a spaced schedule. | Retrieval, spacing, interleaving |

A pattern counts as **mastered** once its Challenge is solved.

## Beyond patterns: internals and judgment

| Surface | Route | What you do | Why |
| --- | --- | --- | --- |
| **Change log** | Build/Challenge → *Changes* tab; Learn step card | Every add, remove, connect, scale, kill or traffic change records a before→after metric diff (p99, capacity, errors, availability, cost, durability), the load shift per node, new risks, and requirements met or broken. | Causal feedback, signalling |
| **Inside** | `/system-design/inside`, `/inside/:kind`, or "Look inside" on any selected component | Animated request path through the component's parts, drag-to-order Assemble, design knobs, implementations (Nginx/HAProxy/Envoy, Redis, Postgres/RocksDB…), HA, failure modes, napkin numbers, interview questions with reveal-after-answering, and labs. Kafka-flavoured parts link to `/kafka`. | Mental models, generation, productive play |
| **Design review** | `/system-design/practice/review/:id` | Critique a flawed design: test it live, flag nodes and edges, and classify each flaw. Scored against an expert critique, with penalties for false alarms. | Erroneous examples, error detection |
| **Incident drill** | `/system-design/practice/incident/:id` | On-call page with a live broken system. Answer triage → root cause → mitigate → prevent, then read the postmortem, a real-world parallel, and recover. | Case-based, deliberate practice |
| **ADR-lite** | `/system-design/practice/adr/:id` | Choose an option and write Decision / Because / We accept / Revisit when, then compare with the expert ADR. Considerations are keyword-detected, with self-ticking for half credit. | Self-explanation, metacognition |

Labs (`internals/labs/*`) are small, deterministic simulations: change an algorithm or config and watch the effect. They cover the gateway filter chain, discovery staleness, registry partitions, LB algorithms with health-check and drain, cache eviction (LRU/LFU/FIFO/TTL), rate-limit algorithms, B-tree vs LSM, consistent-hash ring with vnodes, bloom filter, inverted index, circuit breaker, and queue backlog with autoscaling.

## SDE-3 depth: the Guide tab

Each of the 47 components has a lazy-loaded deep guide (`internals/deep/data/<kind>.ts`) on its **Guide** tab, the first tab under *Inside*. It has a sticky table of contents, collapsible deep dives and a key-takeaways recap. Every guide covers the same 10 sections, and `files/val/validate-deep.ts` enforces them:

1. **Problem and first principles:** why it exists, what breaks without it, and where it sits in the request path.
2. **Architecture:** the building blocks with diagrams, and how real systems are built (Envoy, Kong, Eureka/Consul/etcd, Redis, Postgres/RocksDB, …).
3. **Request lifecycle:** a step-by-step walk-through with a latency budget per stage.
4. **Algorithms and protocols:** the mechanisms in detail.
5. **Scaling and HA.**
6. **Failure modes and war stories:** detection signals and mitigations.
7. **Numbers:** a predict-then-reveal capacity-math drill.
8. **Comparison table:** alternatives, plus *when not to use it*.
9. **Interview:** 5–8 SDE-3 questions, each with a model answer, the follow-up probes an interviewer would ask, and the **senior signal** (what separates an SDE-3 answer from an SDE-2 one).
10. **Labs.**

There are three labs for the components users found thinnest:

- **Gateway filter chain:** drag filters into order and watch latency, auth cost, rejections and leaks change. A coarse per-IP limit belongs *before* AuthN because it needs no identity and sheds floods cheaply. A per-user quota needs a verified identity, so it belongs after AuthN. A cache holding protected responses must sit after both AuthN and AuthZ: before AuthZ, a valid token with the wrong scope or tenant gets a cached 200 it should never see (an authorization bypass). A toggle lets you switch to a public-only cache, which can legitimately sit ahead of auth. The pure model and its checks are in `internals/labs/gatewayModel{,.check}.ts`.
- **Discovery staleness:** kill an instance under Eureka, Kubernetes, DNS or a service mesh, and watch heartbeat, lease, cache and TTL turn into a stale window and failed requests. Mitigate with preStop hooks, retries and outlier ejection.
- **Partition:** compare Eureka self-preservation (AP) with Consul and ZooKeeper/etcd losing quorum (CP).

The judgment drills reuse this depth. The new ones are a gateway design review (`rev-api-gateway-edge`) and a Eureka self-preservation incident (`inc-eureka-self-preservation`).

Why this design:
- **Expertise reversal** (Kalyuga): an SDE-2 learns more from mechanisms, failure modes and tradeoffs than from definitions, so the depth sits up front and the basics are collapsible.
- **Follow-up probes** rehearse the "and then what?" questioning that distinguishes senior interviews.
- **Consistent structure** builds a schema: the same 10 questions get asked of every new component.

## Principles applied

1. **Worked example → faded guidance** (Sweller, Renkl). Learn mode builds the reference step by step. Build keeps feedback and 3 hint levels. Challenge allows 2 hints and hides the missing-parts list.
2. **Prediction before reveal** (generation effect; Slamecka & Graf, Kornell). Guided failure and spike steps wait for a prediction. Killing any node asks "what happens?" first. Prediction accuracy is tracked.
3. **Immediate, specific feedback** (Hattie & Timperley). Every added component explains what it solves *in this scenario* and its tradeoffs. Wrong components turn red with the reason and what to use instead. Wrong links are flagged.
4. **Dual coding and animation** (Paivio, Mayer). Requests flow along edges as dots. Hot nodes glow, dead nodes grey out, failing calls stop mid-edge, queues show backlog, and metrics update live.
5. **Desirable difficulty** (Bjork). Each palette mixes correct parts with plausible traps (bigger server, in-process cache, 2PC across services, sticky sessions…).
6. **Retrieval practice and spaced repetition** (Roediger & Karpicke, Cepeda). Recall questions graded by confidence ("Guessed / Knew it / Easy") feed an SM-2-style schedule. The home page shows what's due.
7. **Interleaving** (Rohrer & Taylor). Review mixes patterns, so you practise *choosing* the pattern, which is the actual interview skill.
8. **Transfer** (Gick & Holyoak). Every Challenge keeps the same deep structure but changes the surface story and numbers.
9. **Concrete anchors** (elaborative encoding). Each pattern lists real systems that use it, and each component lists production tech.
10. **Failure as a teacher** (productive failure; Kapur). Chaos tools (kill an instance, 0.5×–10× traffic) let you break your own design and see SPOFs, cascades and backlogs.
11. **Causal feedback** (Mayer's signalling and contiguity). Each change is shown alongside its measured effect and new risks, so you never have to infer cause from a moving dashboard.
12. **Mechanism over label** (Chi, expert–novice). Inside views and labs teach *how* an LB, Redis, a B-tree or an LSM work, so you can reason about components you've never seen. Assemble drills make you generate the structure.
13. **Erroneous examples** (Große & Renkl). Design reviews train spotting flaws in plausible designs, which is a core senior skill. False-alarm penalties teach you to verify before objecting.
14. **Deliberate, case-based practice** (Ericsson, Klein). Incident drills rehearse decisions under pressure with immediate explanation and blameless postmortems.
15. **Self-explanation + expert comparison** (Chi, Dunlosky). ADR-lite makes you commit and justify before seeing the expert reasoning, which exposes the forces you missed.

## Patterns (20)

- **Scaling:** Load Balancing, Caching (cache-aside), CDN, Replication & Read Replicas, Sharding, Consistent Hashing, Autoscaling & Backpressure.
- **Messaging:** Message Queues & Async Workers, Pub/Sub fan-out.
- **Reliability:** Rate Limiting, Circuit Breakers/Timeouts/Retries, Service Discovery & Health Checks, Leader Election & Consensus, Idempotency.
- **Architecture and data:** API Gateway, CQRS, Event Sourcing, Sagas, Object Storage & Presigned URLs, Search Indexing via CDC.

## How it is built

- `data/components.ts` is the component catalog: what each part solves, its tradeoffs, real-world use, and its flow model (capacity, latency, availability, durability, cost).
- `data/patterns/*` holds each pattern as data: scenario, workload, requirements, reference graph, guided steps, per-scenario wrong-component notes, a challenge, and quizzes.
- `engine/simulate.ts` is a napkin-math flow model. It routes read/write traffic through the graph and computes QPS, p99, errors, availability/SPOFs, durability, consistency and cost.
- `engine/evaluate.ts` checks the requirements, scores closeness to the reference, and generates node/edge verdicts and hints.
- `engine/diff.ts` diffs two evaluations into a change-log entry. `ui/ChangeLog.tsx` renders it.
- `internals/` holds the per-component internals content (`data/*.ts`, typed by `internals/types.ts`), the views (`Anatomy`, `Assemble`, `InternalsView`) and the labs. `internals/deep/` holds the SDE-3 guides (`data/<kind>.ts`, one lazy chunk per component) and their UI (`Guide`, `Diagram`, `DeepInterview`).
- `judgment/` holds review, incident and ADR cases (`data/*.ts`) and the drill pages are in `pages/{Practice,DesignReview,Incident,Adr}.tsx`.
- `store.ts` handles progress (including internals seen, assembled and lab, drill best scores and ADR drafts), saved canvases and spaced-repetition cards, persisted in localStorage under `lp:sd:progress`.
