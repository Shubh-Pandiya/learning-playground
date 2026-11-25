import type { Predict } from '../../types';

export type ScdType = 0 | 1 | 2 | 3 | 4 | 6;
export type Attr = 'name' | 'city' | 'segment';
export type Dim = 'city' | 'segment';

export const SCD_TYPES: ScdType[] = [0, 1, 2, 3, 4, 6];

export const TYPE_INFO: Record<ScdType, { short: string; blurb: string; tables: string }> = {
  0: { short: 'retain original', blurb: 'Never update. Whatever was loaded first stays forever.', tables: 'dim_customer (1 row, frozen)' },
  1: { short: 'overwrite', blurb: 'UPDATE in place. Always current, zero history.', tables: 'dim_customer (1 row, overwritten)' },
  2: { short: 'add row', blurb: 'Expire the current row, INSERT a new version with a new surrogate key.', tables: 'dim_customer (1 row per version)' },
  3: { short: 'add column', blurb: 'Shift current → prev_* column. Exactly one step of history, no dates.', tables: 'dim_customer (1 row, prev_* columns)' },
  4: { short: 'history table', blurb: 'Small current table (Type 1) + a separate append-only history table.', tables: 'dim_customer + dim_customer_history' },
  6: { short: 'hybrid 1+2+3', blurb: 'Type 2 rows, plus cur_* columns overwritten on every version.', tables: 'dim_customer (versions + cur_*)' },
};

export interface Profile {
  name: string;
  city: string;
  segment: string;
  channel: string;
}

export interface TimelineEvent {
  month: string;
  change?: { date: string; kind: 'signup' | 'change' | 'correction'; attr?: Attr; from?: string; to?: string; text: string };
  sale: { id: string; date: string; amount: number };
}

export const CUSTOMER_ID = 'C-1042';
export const SIGNUP: Profile = { name: 'Asha Roa', city: 'Pune', segment: 'Silver', channel: 'ads' };

export const TIMELINE: TimelineEvent[] = [
  {
    month: 'Jan',
    change: { date: '2025-01-05', kind: 'signup', text: 'Asha signs up in **Pune** · segment **Silver** · channel `ads` (name typed as `Asha Roa`, a typo)' },
    sale: { id: 's1', date: '2025-01-20', amount: 12000 },
  },
  { month: 'Feb', sale: { id: 's2', date: '2025-02-14', amount: 8000 } },
  {
    month: 'Mar',
    change: { date: '2025-03-10', kind: 'change', attr: 'city', from: 'Pune', to: 'Mumbai', text: 'Asha **moves** Pune → Mumbai' },
    sale: { id: 's3', date: '2025-03-22', amount: 15000 },
  },
  { month: 'Apr', sale: { id: 's4', date: '2025-04-12', amount: 6000 } },
  {
    month: 'May',
    change: { date: '2025-05-01', kind: 'change', attr: 'segment', from: 'Silver', to: 'Gold', text: 'Asha is **promoted** Silver → Gold' },
    sale: { id: 's5', date: '2025-05-18', amount: 20000 },
  },
  {
    month: 'Jun',
    change: { date: '2025-06-03', kind: 'correction', attr: 'name', from: 'Asha Roa', to: 'Asha Rao', text: 'Support **fixes a typo**: `Asha Roa` → `Asha Rao`' },
    sale: { id: 's6', date: '2025-06-25', amount: 9000 },
  },
];

/** Approximate on-disk bytes per row (Postgres tuple header 24 B + columns). */
export const ROW_BYTES: Record<ScdType, number> = { 0: 80, 1: 80, 2: 100, 3: 100, 4: 80, 6: 120 };
export const HIST_ROW_BYTES = 96;
export const SCALE_CUSTOMERS = 10_000_000;

/** Predictions keyed `t<type>-<step>`. */
export const PREDICTS: Record<string, Predict> = {
  't0-2': {
    question: 'Type 0: the source now says Asha lives in **Mumbai**. What does `dim_customer.city` say after the load?',
    options: ['Mumbai', 'Pune', 'Both, in two rows', 'NULL'],
    answer: 1,
    explain: 'Type 0 ignores every update. Right for `signup_channel` or date of birth, wrong for anything that can legitimately change.',
  },
  't1-2': {
    question: 'After the move under **Type 1**, where do January’s ₹12k sales appear in Revenue by city?',
    options: ['Pune, the city at the time of sale', 'Mumbai', 'Split between Pune and Mumbai', 'Nowhere: the fact row is orphaned'],
    answer: 1,
    explain: 'The fact still points at `customer_sk = 1`, and that one row now says Mumbai. Type 1 **rewrites history**: every past report regroups under the new value.',
  },
  't2-2': {
    question: '**Type 2** receives the move. What happens to the Pune row (`sk = 1`)?',
    options: [
      'It is deleted',
      'Its city is updated to Mumbai',
      'It is expired (`valid_to = 2025-03-10`, `is_current = false`) and a new `sk = 2` row is inserted',
      'Nothing: Mumbai goes into a history table',
    ],
    answer: 2,
    explain: 'Expire + insert. January and February facts keep `customer_sk = 1`, so they stay under Pune forever. New facts get `sk = 2`.',
  },
  't2-4': {
    question: 'How many `dim_customer` rows exist for Asha after the March move **and** the May promotion under Type 2?',
    options: ['1', '2', '3', '4'],
    answer: 2,
    explain: 'One version per tracked change: Pune·Silver (sk 1), Mumbai·Silver (sk 2), Mumbai·Gold (sk 3). Row count grows with change frequency, not customer count.',
  },
  't2-5': {
    question: 'June’s change is a **typo fix** in `name`. What should a well-built Type 2 pipeline do?',
    options: ['Insert a 4th version with the fixed name', 'Overwrite `name` on all 3 versions (name is a Type 1 attribute)', 'Ignore it', 'Fix only the current row'],
    answer: 1,
    explain: 'A correction is not a business event. Versioning it would fabricate a "name changed on Jun 3" fact and grow the dim. Exclude `name` from the hashdiff and overwrite it on every version.',
  },
  't3-2': {
    question: '**Type 3** receives the move. Which report can you still build afterwards?',
    options: ['Revenue by city at time of sale', 'Revenue by current city next to previous city', 'Full city history for Asha', 'None: history is gone'],
    answer: 1,
    explain: '`city = Mumbai`, `prev_city = Pune` on one row. You get "current vs previous", but facts don’t know which applied when, and a second move pushes Pune out for good.',
  },
  't4-2': {
    question: '**Type 4** receives the move. Which tables are written?',
    options: [
      'Only dim_customer',
      'dim_customer is overwritten, and dim_customer_history closes the Pune version and appends Mumbai',
      'fact_sales is rewritten with the new city',
      'None: Type 4 only changes queries',
    ],
    answer: 1,
    explain: 'The current table stays one row per customer (Type 1). History lives in a separate table that only as-was queries pay for.',
  },
  't6-2': {
    question: 'Type 6 after the move: January’s fact points at `sk = 1` (city Pune). What does `cur_city` on `sk = 1` say?',
    options: ['Pune', 'Mumbai', 'NULL', 'sk = 1 was deleted'],
    answer: 1,
    explain: 'Type 6 overwrites `cur_city` on **every** version (the Type 1 part), so one join gives both `city` (as-was) and `cur_city` (as-is).',
  },
};

export const PICK_CARDS: { id: string; text: string; answer: ScdType; why: string }[] = [
  { id: 'typo', text: 'Fix typos in customer names. Nobody cares what the name used to be.', answer: 1, why: 'Corrections are not history: overwrite in place (Type 1).' },
  { id: 'region', text: 'Finance reports sales by region **as it was at the time of sale**, for any past period.', answer: 2, why: 'Point-in-time attribution needs one row per version and facts keyed by that version’s surrogate key (Type 2).' },
  { id: 'territory', text: 'Sales ops only wants to compare the **current vs previous** territory after a re-org.', answer: 3, why: 'Exactly one step of history, side by side on one row: Type 3’s `prev_territory`.' },
  { id: 'credit', text: 'A credit-score band changes **monthly** for 50M customers.', answer: 4, why: 'Type 2 would add ~600M versions a year. Split the volatile band into a mini-dimension / history table (Type 4) so the main dim stays 50M rows.' },
  { id: 'both', text: 'Analysts need **both** as-was and as-is reporting from one join, without self-joins.', answer: 6, why: 'Type 6: versioned rows for as-was plus `current_*` columns overwritten on every version for as-is.' },
  { id: 'channel', text: 'The original **signup channel** must never change, even if marketing re-attributes the customer.', answer: 0, why: 'Immutable by definition: Type 0 retains the original value.' },
];

export const ASWAS_QS: { id: string; text: string; answer: ScdType; why: string }[] = [
  { id: 'q0', text: 'As-was: Pune ₹70k · Mumbai ₹0. As-is: Pune ₹70k · Mumbai ₹0. One row with `city = Pune`, although she moved in March.', answer: 0, why: 'Only Type 0 ignores the move entirely: both reports are wrong for Mar–Jun.' },
  { id: 'q1', text: 'As-was and as-is are identical: Mumbai ₹70k. One row; nothing says she ever lived in Pune.', answer: 1, why: 'Type 1 overwrote the only row: January’s ₹12k now shows under Mumbai.' },
  {
    id: 'q2',
    text: 'As-was: Pune ₹20k · Mumbai ₹50k via `JOIN ON customer_sk`. As-is: Mumbai ₹70k, but only via a self-join `ON d2.customer_id = d.customer_id AND d2.is_current`.',
    answer: 2,
    why: 'Pure Type 2: versions give as-was for free; as-is needs the current row of the same natural key.',
  },
  { id: 'q3', text: 'One row: `city = Mumbai`, `prev_city = Pune`. Current vs previous side by side works; revenue by city at time of sale does not.', answer: 3, why: 'Type 3 keeps one previous value, without dates.' },
  {
    id: 'q4',
    text: 'As-is from a one-row-per-customer table (Mumbai ₹70k). As-was (Pune ₹20k · Mumbai ₹50k) needs a range join to a separate table on the sale date.',
    answer: 4,
    why: 'Type 4: current table + history table.',
  },
  { id: 'q5', text: 'Both from the same row: `GROUP BY city` gives Pune ₹20k · Mumbai ₹50k, `GROUP BY cur_city` gives Mumbai ₹70k.', answer: 6, why: 'Type 6: historical column + current column on every version.' },
];

/** Type 2 final dimension used by the late-arriving fact exercise. */
export const LATE_DIM = [
  { sk: 1, city: 'Pune', segment: 'Silver', validFrom: '2025-01-05', validTo: '2025-03-10', isCurrent: false },
  { sk: 2, city: 'Mumbai', segment: 'Silver', validFrom: '2025-03-10', validTo: '2025-05-01', isCurrent: false },
  { sk: 3, city: 'Mumbai', segment: 'Gold', validFrom: '2025-05-01', validTo: '9999-12-31', isCurrent: true },
];

export const LATE_FACTS: { id: string; date: string; arrived: string; amount: number; answer: number; wrong: Record<number, string> }[] = [
  {
    id: 'late-apr',
    date: '2025-04-28',
    arrived: '2025-06-30',
    amount: 7000,
    answer: 2,
    wrong: {
      1: '`sk = 1` is valid `[2025-01-05, 2025-03-10)`. April 28 is after it expired.',
      3: 'That is the `WHERE is_current` bug: a late fact lands on **today’s** version, so April revenue is reported as Gold.',
    },
  },
  {
    id: 'late-may',
    date: '2025-05-01',
    arrived: '2025-06-30',
    amount: 5000,
    answer: 3,
    wrong: {
      1: '`sk = 1` expired on 2025-03-10.',
      2: 'Boundary trap: `sk = 2` is valid `[2025-03-10, 2025-05-01)`, half-open, so May 1 is **excluded**. With `BETWEEN` (inclusive on both ends) it matches sk 2 **and** sk 3 and double-counts ₹5k.',
    },
  },
];
