import { lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Boxes, Database, ListTree, Network, Waypoints, Workflow } from 'lucide-react';
import type { ModuleId, ProgressNamespace } from '@/shared/progress';

export interface ModuleDef {
  id: ModuleId;
  /** Route prefix; the module owns everything under `${path}/*`. */
  path: string;
  /** localStorage namespace (`lp:<ns>:*`). */
  namespace: ProgressNamespace;
  title: string;
  short: string;
  blurb: string;
  icon: ReactNode;
  /** Default unit when the module hasn't reported yet. */
  unit: string;
  highlights: string[];
  Component: LazyExoticComponent<ComponentType>;
}

export interface TrackDef {
  id: 'algorithms' | 'systems' | 'data';
  index: string;
  title: string;
  tagline: string;
  modules: ModuleDef[];
}

export const tracks: TrackDef[] = [
  {
    id: 'algorithms',
    index: '01',
    title: 'Algorithms',
    tagline: 'Recognise the pattern, picture the loop, write it from scratch.',
    modules: [
      {
        id: 'dsa',
        path: '/dsa',
        namespace: 'dsa',
        title: 'DSA Patterns',
        short: 'DSA',
        blurb:
          'The NeetCode sheet as drag-and-drop pattern puzzles. Step through loops and pointers, predict before you reveal, and see where each pattern runs in real backend systems.',
        icon: <ListTree size={20} />,
        unit: 'problems',
        highlights: ['loop traces', 'pattern drills', 'backend use-cases'],
        Component: lazy(() => import('@/modules/dsa')),
      },
    ],
  },
  {
    id: 'systems',
    index: '02',
    title: 'Systems',
    tagline: 'Compose systems, then open each box to see how it is built inside.',
    modules: [
      {
        id: 'system-design',
        path: '/system-design',
        namespace: 'sd',
        title: 'System Design',
        short: 'System Design',
        blurb:
          'Drag components onto a canvas to build the top system designs. Every piece explains what it solves and its tradeoffs, wrong pieces get flagged, and traffic animates through the live diagram.',
        icon: <Boxes size={20} />,
        unit: 'designs',
        highlights: ['animated request flow', 'component internals', 'tradeoff feedback'],
        Component: lazy(() => import('@/modules/system-design')),
      },
      {
        id: 'kafka',
        path: '/kafka',
        namespace: 'kafka',
        title: 'Kafka',
        short: 'Kafka',
        blurb:
          'Producers, partitions, consumer groups, offsets and replication — visualised. Break a broker, add a consumer, change acks and watch what happens to ordering, lag and durability.',
        icon: <Workflow size={20} />,
        unit: 'concepts',
        highlights: ['partitions & offsets', 'consumer groups', 'failure drills'],
        Component: lazy(() => import('@/modules/kafka')),
      },
    ],
  },
  {
    id: 'data',
    index: '03',
    title: 'Data Engineering',
    tagline: 'Query real Postgres in your browser, model data the way production needs it, and design pipelines that stay correct at scale.',
    modules: [
      {
        id: 'sql',
        path: '/sql',
        namespace: 'sql',
        title: 'Advanced SQL',
        short: 'SQL',
        blurb:
          'Run real SQL (Postgres in WASM) and watch each clause transform the rows: joins, window functions, CTEs, recursive queries, indexes and query plans.',
        icon: <Database size={20} />,
        unit: 'exercises',
        highlights: ['live Postgres', 'row-by-row visuals', 'query plans'],
        Component: lazy(() => import('@/modules/sql')),
      },
      {
        id: 'data-modeling',
        path: '/data-modeling',
        namespace: 'dm',
        title: 'Data Modelling',
        short: 'Data Modelling',
        blurb:
          'Drag entities and relationships to design schemas: normalisation, star and snowflake schemas, SCDs, and partitioning — with instant feedback on what each change costs or buys.',
        icon: <Network size={20} />,
        unit: 'models',
        highlights: ['ERD builder', 'OLTP vs OLAP', 'impact feedback'],
        Component: lazy(() => import('@/modules/data-modeling')),
      },
      {
        id: 'de-system-design',
        path: '/de-system-design',
        namespace: 'desd',
        title: 'Data Engineering System Design',
        short: 'DE System Design',
        blurb:
          'Drag Kafka, Flink, Spark, Airflow, Iceberg, warehouses and OLAP stores into pipelines and watch freshness, delivery guarantees, backfill and cost change. Break them with late data, schema changes and replays.',
        icon: <Waypoints size={20} />,
        unit: 'patterns',
        highlights: ['pipeline builder', 'data chaos drills', 'inside Spark/Flink/Iceberg'],
        Component: lazy(() => import('@/modules/de-system-design')),
      },
    ],
  },
];

export const allModules: ModuleDef[] = tracks.flatMap((t) => t.modules);
