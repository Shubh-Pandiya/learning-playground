import type { ChaosId, ComponentKind, Workload } from '../types';

/** A node in a pre-built drill graph (same coordinate system as pattern reference graphs: x step ≈ 190, y ≈ 0..400). */
export interface DrillNode {
  id: string;
  kind: ComponentKind;
  label?: string;
  count?: number;
  x: number;
  y: number;
}

export interface DrillGraph {
  nodes: DrillNode[];
  edges: { from: string; to: string }[];
}

export type FlawKind = 'data-loss' | 'duplicates' | 'late-data' | 'schema' | 'spof' | 'bottleneck' | 'freshness' | 'wrong-tool' | 'cost' | 'governance';

export const FLAW_LABEL: Record<FlawKind, string> = {
  'data-loss': 'Data loss risk',
  duplicates: 'Duplicates / double counting',
  'late-data': 'Late / out-of-order data mishandled',
  schema: 'Schema change breaks or corrupts',
  spof: 'Single point of failure',
  bottleneck: 'Throughput bottleneck / skew',
  freshness: 'Too stale for the requirement',
  'wrong-tool': 'Wrong tool for the job',
  cost: 'Wasteful / over-engineered',
  governance: 'Governance / PII / quality gap',
};

/** Design review: critique a flawed design. User flags nodes/edges and classifies each flaw. */
export interface ReviewCase {
  id: string;
  title: string;
  /** Product context and what the design is supposed to do. */
  context: string;
  workload: Workload;
  level: 'Intermediate' | 'Advanced';
  /** Related pattern ids (links to /de-system-design/p/:id). */
  patterns: string[];
  graph: DrillGraph;
  flaws: {
    /** A node id, or an edge id written `from->to`. */
    target: string;
    kind: FlawKind;
    title: string;
    why: string;
    fix: string;
  }[];
  /** Explanations for parts that look suspicious but are fine (shown if flagged). */
  fine?: Record<string, string>;
  takeaway: string;
}

/** Incident / postmortem drill. The graph is rendered live with the failure injected. */
export interface IncidentCase {
  id: string;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  /** The page you get woken up by. */
  alert: string;
  context: string;
  workload: Workload;
  patterns: string[];
  graph: DrillGraph;
  /** Failure injected into the live simulation. */
  inject: { down?: { node: string; count: number }[]; traffic?: number; chaos?: ChaosId };
  timeline: { t: string; event: string }[];
  /** Dashboard signals shown at triage. */
  signals: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }[];
  /** Usually 4 stages: triage → root cause → mitigate now → prevent. */
  stages: { title: string; question: string; options: string[]; answer: number; explain: string }[];
  /** Blameless-postmortem lesson. */
  lesson: string;
  /** A real incident with the same shape, if any. */
  realWorld?: string;
}

/** ADR-lite: write a short decision record, then compare with the expert one. */
export interface AdrCase {
  id: string;
  title: string;
  /** The decision to make and the forces at play. */
  context: string;
  patterns: string[];
  options: { name: string; summary: string }[];
  /** Index of the option the expert picks. */
  recommended: number;
  /** What a strong answer mentions; keywords (lowercase, matched as substrings) auto-detect coverage. */
  considerations: { label: string; keywords: string[]; why: string }[];
  expert: { decision: string; rationale: string[]; consequences: string[]; revisitWhen: string };
}
