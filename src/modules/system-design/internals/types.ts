import type { ComponentKind } from '../types';

/** Interactive lab rendered in the "Inside" view (bespoke simulation per id). */
export type LabId = 'lb' | 'eviction' | 'storage' | 'ratelimit' | 'ring' | 'inverted' | 'bloom' | 'breaker' | 'queue' | 'gateway' | 'discovery' | 'partition';

/** One internal building block. `parts` are listed in the order a request/data passes through them. */
export interface InternalPart {
  id: string;
  name: string;
  /** ≤ 8 words: what this part does. */
  role: string;
  /** 1–3 sentences: how it is actually built. Supports **bold** and `code`. */
  detail: string;
}

/** One step of the animated walk-through of a request inside the component. */
export interface InternalStep {
  /** id of the InternalPart that is active in this step. */
  part: string;
  title: string;
  /** 1–3 sentences. Supports **bold** and `code`. */
  text: string;
}

/** A design decision / configuration knob and what each choice does to the system. */
export interface Knob {
  name: string;
  options: { label: string; effect: string; when: string }[];
}

export interface Internals {
  kind: ComponentKind;
  /** The mental model in 2–3 sentences. */
  summary: string;
  /** 4–7 parts in request/data-path order (drives the anatomy diagram and the drag-to-assemble exercise). */
  parts: InternalPart[];
  /** 4–8 steps walking one request/write through the parts. */
  flow: InternalStep[];
  /** 2–4 design decisions. */
  knobs: Knob[];
  /** How real implementations are built (2–4 entries). */
  implementations: { name: string; how: string }[];
  /** How this component itself is made highly available and scaled. */
  ha: string;
  /** 2–4 ways it fails in production. */
  failureModes: { name: string; symptom: string; fix: string }[];
  /** Napkin numbers worth remembering. */
  numbers?: string[];
  /** 2–3 deep-dive interview questions with model answers. */
  interview: { q: string; a: string }[];
  lab?: LabId;
  /** Additional labs shown next to `lab` (lab tab gets a switcher). */
  moreLabs?: LabId[];
  /** Show the "go deeper in the Kafka module" link. */
  kafka?: boolean;
}

/* ───────────────────────── SDE-3 depth layer ─────────────────────────
 * One `Deep` object per component kind, in `internals/deep/<kind>.ts` (default export).
 * Text fields support **bold** and `code` inline markup only (no markdown lists/headings/links).
 * Write for an SDE-2 becoming SDE-3: mechanisms, real systems, numbers, failure stories, and judgment.
 */

export type DiagramTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info' | 'violet';

/** Visual-first diagrams rendered by `internals/deep/Diagram.tsx`. Keep labels short (≤ 5 words). */
export type Diagram =
  /** Left-to-right pipeline of boxes, e.g. listener → filter chain → router → cluster. `sub` is a 2nd line (≤ 6 words). */
  | { type: 'flow'; title?: string; nodes: { label: string; sub?: string; tone?: DiagramTone }[]; caption?: string }
  /** Sequence diagram between 2–6 actors; messages reference actor names exactly. 3–12 messages. */
  | {
      type: 'sequence';
      title?: string;
      actors: string[];
      messages: { from: string; to: string; label: string; dashed?: boolean; tone?: DiagramTone }[];
      caption?: string;
    }
  /** Stacked layers (top = closest to the client), e.g. control plane over data plane. 2–5 layers, 2–6 items each. */
  | { type: 'layers'; title?: string; layers: { name: string; items: string[]; tone?: DiagramTone }[]; caption?: string }
  /** Side-by-side comparison of 2–3 variants, each a short list of facts (e.g. client-side vs server-side discovery). */
  | { type: 'compare'; title?: string; columns: { name: string; points: string[]; tone?: DiagramTone }[]; caption?: string };

export interface DeepTable {
  caption?: string;
  /** First column is the row label. 3–7 columns. */
  columns: string[];
  rows: string[][];
}

/** A collapsible deep-dive on one algorithm / protocol / mechanism. */
export interface DeepSection {
  title: string;
  /** One line: why this matters (shown when collapsed). */
  hook: string;
  /** 1–4 short paragraphs. */
  body: string[];
  bullets?: string[];
  diagram?: Diagram;
  table?: DeepTable;
  /** Real config / pseudo-code / protocol snippet, ≤ 25 lines. lang: 'yaml' | 'lua' | 'go' | 'java' | 'python' | 'bash' | 'json' | 'sql' | 'text'. */
  code?: { lang: string; code: string; caption?: string };
  /** "Senior note": the non-obvious consequence most engineers miss. */
  insight?: string;
}

export interface Deep {
  kind: ComponentKind;
  /** 1. First principles. */
  problem: {
    /** Why it exists, 2–4 sentences. */
    why: string;
    /** 3–5 concrete things that break without it. */
    withoutIt: string[];
    /** Where it sits in the request path and what it talks to (1–2 sentences). */
    position: string;
    diagram?: Diagram;
  };
  /** 2. Internal architecture. */
  architecture: {
    overview: string;
    diagram: Diagram;
    /** 4–8 real building blocks / data structures. */
    blocks: { name: string; what: string }[];
    /** 3–5 real implementations and how each is built (e.g. Envoy, Kong, AWS API GW). */
    real: { name: string; how: string }[];
  };
  /** 3. Request lifecycle with timing: 5–10 stages. `ms` = typical added latency (drives the waterfall; use 0.01 for µs-level). */
  lifecycle: {
    summary: string;
    stages: { stage: string; what: string; cost: string; ms: number; part?: string }[];
  };
  /** 4. Algorithms & protocols: 4–8 deep dives. */
  deepDives: DeepSection[];
  /** 5. Scaling & HA: control plane vs data plane, multi-region, config propagation. */
  scaling: { body: string[]; bullets: string[]; diagram?: Diagram };
  /** 6a. 4–7 failure modes with how you DETECT them (metric/alert) and mitigate. */
  failures: { name: string; symptom: string; detect: string; mitigate: string }[];
  /** 6b. 2–4 production war stories (real public incidents where possible; say "composite" if not). */
  warStories: { title: string; source: string; what: string; lesson: string }[];
  /** 7. 6–12 numbers worth remembering. */
  numbers: { label: string; value: string; note?: string }[];
  /** 7b. A worked capacity estimate: question + 3–6 steps + answer. */
  capacity: { question: string; steps: string[]; answer: string };
  /** 8. Comparison of alternatives/products (3–6 rows) + when NOT to use it. */
  comparison: DeepTable;
  whenNot: string[];
  /** 9. 5–8 SDE-3 interview questions. */
  interview: { q: string; a: string; followUps: string[]; seniorSignal: string }[];
  /** 5–8 one-line key takeaways (recap). */
  takeaways: string[];
}
