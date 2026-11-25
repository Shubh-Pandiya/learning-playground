/** Kafka vs other messaging systems, and when not to use Kafka. */

export type Score = 0 | 1 | 2 | 3;

export interface System {
  id: string;
  name: string;
  model: string;
  bestFor: string;
  avoidWhen: string;
  internals: string;
}

export const SYSTEMS: System[] = [
  {
    id: 'kafka',
    name: 'Apache Kafka',
    model: 'Partitioned, replicated append-only log. Consumers pull and track offsets; data is retained independent of consumption.',
    bestFor: 'High-throughput event streams, multiple independent consumers, replay, ordered per-key processing, CDC, stream processing.',
    avoidWhen: 'Per-message job queues with variable processing time, request/reply, tiny volumes where operating a cluster isn’t worth it, or ad-hoc querying.',
    internals: 'Segments + page cache + sendfile; ISR replication; KRaft metadata; consumer groups via a coordinator.',
  },
  {
    id: 'rabbit',
    name: 'RabbitMQ',
    model: 'Broker routes messages from exchanges to queues; messages are pushed to consumers and deleted on ack.',
    bestFor: 'Task queues, complex routing (topic/headers exchanges), per-message acks, priorities, delayed delivery, RPC.',
    avoidWhen: 'You need replay, many independent readers of the same history, or millions of msg/s.',
    internals: 'Erlang/OTP; quorum queues replicate via Raft; streams (3.9+) add a log-like type.',
  },
  {
    id: 'sqs',
    name: 'Amazon SQS',
    model: 'Fully managed queue. Visibility timeout hides a message while a consumer works; delete = ack. FIFO queues give ordering per message group.',
    bestFor: 'Serverless/AWS job queues with zero ops, elastic consumers, built-in DLQ redrive.',
    avoidWhen: 'Replay, fan-out to many consumers (use SNS+SQS), very high ordered throughput (FIFO limits), long retention (max 14 days).',
    internals: 'Distributed, redundantly stored across AZs; standard queues are at-least-once with best-effort ordering.',
  },
  {
    id: 'kinesis',
    name: 'Amazon Kinesis Data Streams',
    model: 'Managed sharded log, very similar to Kafka partitions (shards), with per-shard limits (1 MB/s in, 2 MB/s out).',
    bestFor: 'AWS-native streaming without running Kafka; Lambda/Firehose integration.',
    avoidWhen: 'You need Kafka’s ecosystem (Connect, Streams), high per-shard throughput, or long retention cheaply.',
    internals: 'Shards with sequence numbers; KCL uses DynamoDB for leases and checkpoints (the equivalent of consumer groups).',
  },
  {
    id: 'pulsar',
    name: 'Apache Pulsar',
    model: 'Log storage separated from serving: stateless brokers + BookKeeper bookies; supports both streaming and queue (shared) subscriptions.',
    bestFor: 'Multi-tenancy, geo-replication built in, queue + stream semantics in one system, fast partition rebalancing (no data copy).',
    avoidWhen: 'You want the largest ecosystem and talent pool, or simpler operations (more moving parts: brokers, bookies, metadata store).',
    internals: 'Segments striped across bookies; brokers own topics but hold no data, so failover is quick.',
  },
];

export interface Dimension {
  label: string;
  scores: Record<string, Score>;
  note: string;
}

export const DIMENSIONS: Dimension[] = [
  { label: 'Throughput', scores: { kafka: 3, rabbit: 1, sqs: 2, kinesis: 2, pulsar: 3 }, note: 'Kafka/Pulsar: millions msg/s per cluster. SQS scales horizontally but per-message overhead is higher.' },
  { label: 'Replay / retention', scores: { kafka: 3, rabbit: 1, sqs: 0, kinesis: 2, pulsar: 3 }, note: 'Logs keep data after consumption; queues delete on ack.' },
  { label: 'Per-key ordering', scores: { kafka: 3, rabbit: 1, sqs: 2, kinesis: 3, pulsar: 3 }, note: 'Partitions/shards/key-shared subscriptions vs single-queue order with one consumer.' },
  { label: 'Per-message job semantics', scores: { kafka: 1, rabbit: 3, sqs: 3, kinesis: 0, pulsar: 2 }, note: 'Acks, visibility timeouts, redelivery counts, priorities. Kafka 4.0 share groups help.' },
  { label: 'Routing flexibility', scores: { kafka: 1, rabbit: 3, sqs: 1, kinesis: 0, pulsar: 1 }, note: 'RabbitMQ exchanges route by pattern/headers.' },
  { label: 'Operational simplicity', scores: { kafka: 1, rabbit: 2, sqs: 3, kinesis: 3, pulsar: 0 }, note: 'Managed services win; Pulsar has the most components.' },
  { label: 'Ecosystem', scores: { kafka: 3, rabbit: 2, sqs: 2, kinesis: 1, pulsar: 1 }, note: 'Connect, Streams, ksqlDB, Flink, Debezium, Schema Registry.' },
];

export interface NotKafka {
  situation: string;
  instead: string;
  why: string;
}

export const WHEN_NOT: NotKafka[] = [
  { situation: 'Low-volume task queue (emails, thumbnails) with variable job time', instead: 'SQS / RabbitMQ / a DB-backed queue', why: 'Per-message acks and no partition-bound concurrency; nothing to operate.' },
  { situation: 'Synchronous request/response between services', instead: 'HTTP/gRPC', why: 'Kafka adds latency and makes errors asynchronous; request/reply over Kafka is awkward.' },
  { situation: 'You need to query data by arbitrary fields', instead: 'A database (fed by Kafka if needed)', why: 'Kafka only reads by offset/timestamp; build materialized views elsewhere.' },
  { situation: 'A handful of events per minute between two services', instead: 'Outbox table + poller, or Postgres LISTEN/NOTIFY', why: 'A Kafka cluster is a lot of operational weight for tiny traffic.' },
  { situation: 'Large blobs (videos, 50 MB files)', instead: 'Object storage + Kafka message with a reference (claim-check pattern)', why: 'Kafka is tuned for ~1 KB–1 MB records; big records hurt batching and memory.' },
  { situation: 'Delayed / scheduled delivery (“send in 3 days”)', instead: 'A scheduler, SQS delay, RabbitMQ delayed exchange', why: 'Kafka has no per-message delay; retry topics only approximate it.' },
];

/** Quick picker: answer a few questions, get a recommendation. */
export interface PickQ {
  q: string;
  options: { label: string; weights: Partial<Record<string, number>> }[];
}

export const PICKER: PickQ[] = [
  { q: 'Do several independent consumers need the same events, or replay later?', options: [{ label: 'Yes', weights: { kafka: 2, pulsar: 2, kinesis: 1 } }, { label: 'No, each message is a job for one worker', weights: { rabbit: 2, sqs: 2 } }] },
  { q: 'Throughput?', options: [{ label: '> 100k msg/s', weights: { kafka: 2, pulsar: 2, kinesis: 1 } }, { label: '< 1k msg/s', weights: { sqs: 2, rabbit: 1 } }, { label: 'In between', weights: { kafka: 1, rabbit: 1, kinesis: 1 } }] },
  { q: 'Who operates it?', options: [{ label: 'We want zero ops on AWS', weights: { sqs: 2, kinesis: 2 } }, { label: 'Platform team / managed Kafka', weights: { kafka: 2, pulsar: 1 } }] },
  { q: 'Processing time per message?', options: [{ label: 'Uniform, milliseconds', weights: { kafka: 1, kinesis: 1 } }, { label: 'Variable, seconds to minutes', weights: { sqs: 2, rabbit: 2, pulsar: 1 } }] },
  { q: 'Need stream processing / CDC ecosystem?', options: [{ label: 'Yes', weights: { kafka: 3 } }, { label: 'No', weights: {} }] },
];
