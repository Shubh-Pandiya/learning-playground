import type { ComponentKind, Workload } from '../types';

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

export type FlawKind = 'spof' | 'bottleneck' | 'data-loss' | 'consistency' | 'latency' | 'coupling' | 'wrong-tool' | 'cost' | 'security';

export const FLAW_LABEL: Record<FlawKind, string> = {
  spof: 'Single point of failure',
  bottleneck: 'Throughput bottleneck',
  'data-loss': 'Data loss risk',
  consistency: 'Consistency / correctness bug',
  latency: 'Latency problem',
  coupling: 'Tight coupling / cascading failure',
  'wrong-tool': 'Wrong tool for the job',
  cost: 'Wasteful / over-engineered',
  security: 'Security / abuse exposure',
};

/** Design review: critique a flawed design. User flags nodes/edges and classifies each flaw. */
export interface ReviewCase {
  id: string;
  title: string;
  /** Product context and what the design is supposed to do. */
  context: string;
  workload: Workload;
  level: 'Intermediate' | 'Advanced';
  /** Related pattern ids (links to /system-design/p/:id). */
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
  inject: { down?: { node: string; count: number }[]; traffic?: number };
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
