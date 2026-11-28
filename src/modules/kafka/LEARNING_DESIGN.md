# Kafka Playground: learning design

Goal: build **engineering judgment** about event streaming, not just Kafka vocabulary. Given a system and its requirements, the learner should:

- choose a sound Kafka design,
- predict how it behaves under load and failure,
- explain the mechanism inside the broker or client that causes it, and
- know when Kafka is the wrong tool.

Everything runs on a deterministic model of a Kafka cluster (`engine/`). Every interaction produces a cause-and-effect explanation, so no interaction is a dead end.

## Structure

| Surface | Route | Purpose |
|---|---|---|
| Home | `/kafka` | Lesson path with L/B/C pips, mastery, prediction and chaos calibration, resume |
| Lessons (10) | `/kafka/l/:id/{learn,build,challenge,recap}` | Worked → faded → transfer, then retrieval and interview practice |
| Lab | `/kafka/lab` | Free drag-and-drop build with templates, live impact narration, chaos |
| Internals (13) | `/kafka/internals[/:id]` | Frame-by-frame animated deep dives into how Kafka is built |
| Drills | `/kafka/drills[/:kind/:id]` | Incidents on the live simulator, capacity math, config review, trade-offs |
| Compare | `/kafka/compare` | Kafka vs RabbitMQ / SQS / Kinesis / Pulsar, a picker, and when not to use Kafka |
| Review | `/kafka/review` | SM-2 spaced, interleaved recall of quizzes and predictions |
| Method | `/kafka/method` | This document, in the app |

## Principles → mechanics

1. **Predict before reveal** (generation effect, prediction error).
   - Learn steps with a `predict` don't apply their change until you answer.
   - Internals frames with a `predict` keep their visual blurred until you answer.
   - The chaos bar asks what will happen before it injects the failure. The answer is derived from the model's before/after state (`ui/chaos.ts → classify`), not hard-coded.
   - Accuracy is shown on Home as calibration.
2. **Every change explains itself** (immediate, specific feedback).
   - `ui/useLab.ts` diffs the model before and after every mutation.
   - `engine/impact.ts` produces the change, the metric deltas and the mechanism. Metrics include throughput, produce and end-to-end p99, lag, delivery semantics, ordering, durability and consumer parallelism.
   - `engine/tick.ts` adds the cluster events: elections, ISR shrink and expand, rebalances, evictions.
   - The result shows as a toast, as the Impact feed, and in the Inspector's per-option notes and "How it works · interview" expanders.
3. **Worked → faded → scratch** (cognitive load theory).
   - Learn is a worked example on a live canvas.
   - Build is a broken scenario with requirements, a closeness score and 3 graded hints, then the reference.
   - Challenge is the same concept in a new domain, with no stage set.
4. **Transfer** (far transfer by varied practice).
   - Each challenge reframes the concept, for example orders → IoT telemetry, or payments → regulated audit log.
   - Incident drills mix all lessons together.
5. **Mechanism first: how it's actually built.**
   - Every component has a "How it's built" tab: internals, tradeoffs, pitfall, used by.
   - Every knob has a `how` that explains the broker or client machinery.
   - Thirteen deep dives cover: zero-copy and the page cache; segments and sparse indexes; partitioners; replication with HW/LEO/ISR and unclean election; idempotent producers (PID, epoch, sequence); transactions and EOS (coordinator, markers, LSO); the rebalance protocol (eager vs cooperative, static membership); KRaft vs ZooKeeper; compaction; producer internals (accumulator, linger, in-flight, buffer.memory); offset commits and delivery semantics; retention and tiered storage (KIP-405); Kafka Streams state stores (RocksDB, changelogs, standbys).
   - SDE-3 layer, on each dive's final page: numbers to know, tradeoff tables, two real-world incidents (symptom first; cause, fix and lesson revealed on demand) and 5–7 interview Q&As. Each answer comes with follow-up probes and the senior signal, so you rehearse the second and third question, not just the first.
6. **Red flags as feedback** (error-based learning).
   - `engine/check.ts` and the model flag real production mistakes and give a fix. Examples: idle consumers beyond the partition count, acks=1 with RF=1, random keys breaking order, min.insync = RF, no DLQ, auto-commit with async processing, unclean election.
   - Info-level tips are folded away so warnings stay salient.
7. **Desirable difficulty through chaos.**
   - Kill a broker or the leader, slow a broker, slow a consumer, inject a poison message, a hot key, or a ×3 traffic spike.
   - Each runs predict-first, then reveals the outcome with "why" bullets.
8. **Spaced, interleaved retrieval.**
   - Quiz answers and every learn or dive prediction become SM-2 cards (`q:`, `p:`, `d:` ids) in `lp:kafka:progress`.
   - Review interleaves cards by source, and confidence grades (Guessed / Knew it / Easy) set the interval.
   - Due cards are reported to the home page's "Today" plan through `useReportProgress('kafka', { reviews, nextSteps })`.
9. **Judgment drills** (deliberate practice of senior skills).
   - Incidents: diagnose from an alert and signals on a live, locked system, then apply the fix and read its impact, then the follow-up actions a strong engineer would take.
   - Sizing: partitions, consumers, disk, network and time-to-data-loss.
   - Spot the bad config: graded on hits minus false positives.
   - Trade-off calls: best, workable or wrong, each with a why.
10. **Knowing when not to.** The Compare page trains choosing tools by requirements.

## Coverage (interview-relevant)

- **Topics and logs:** partitions, keys and ordering, the partitioner (murmur2, sticky), partition-count trade-offs.
- **Replication and durability:**
  - RF, acks 0/1/all, min.insync.replicas, ISR, HW/LEO.
  - Unclean leader election.
  - Controller and KRaft.
- **Producers:** batching, linger.ms, compression, retries, idempotence, transactions and EOS.
- **Consumer groups:**
  - Assignment strategies (range, round-robin, sticky, cooperative-sticky).
  - Rebalancing, static membership, max.poll.interval.
  - Commits (auto vs manual), lag.
- **Retention vs compaction:** tombstones, segment rolling.
- **Patterns:**
  - Retry topics and DLQ, poison messages.
  - Outbox and CDC with Debezium, Connect, Streams, Schema Registry.
  - Event sourcing, hot partitions.
- **Operations and capacity:** sizing, lag incidents, broker failure.
- **Comparisons:** RabbitMQ, SQS, Kinesis, Pulsar; when not to use Kafka.

## Simplifications

The engine is a steady-state analytical model plus a visual tick, not a real broker:

- Numbers are representative.
- Effects are directionally faithful and deterministic, so predictions can be graded.
