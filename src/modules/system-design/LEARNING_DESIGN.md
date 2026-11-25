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
- `store.ts` handles progress, saved canvases and spaced-repetition cards, persisted in localStorage under `lp:sd:progress`.
