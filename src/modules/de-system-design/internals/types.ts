import type { ComponentKind } from '../types';

/** Interactive lab rendered in the "Inside" view (bespoke simulation per id). */
export type LabId = 'spark' | 'flink' | 'parquet' | 'iceberg' | 'airflow' | 'cdc' | 'olap';

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
  /** Show the "go deeper in the Kafka module" link. */
  kafka?: boolean;
}
