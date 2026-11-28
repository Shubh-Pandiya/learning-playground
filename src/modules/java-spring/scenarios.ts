import type { Frame, Question } from './data';

interface Scenario { label: string; prediction: Question; frames: Frame[] }
const f = (title: string, explain: string, lanes: [string, string, boolean?][]): Frame => ({
  title, explain, lanes: lanes.map(([label, value, active]) => ({ label, value, active })),
});

/** Change one causal boundary, not just the wording of the original trace. */
export const COUNTERFACTUALS: Partial<Record<string, Scenario>> = {
  jmm: {
    label: 'Replace volatile ++ with an atomic increment',
    prediction: {
      prompt: 'With AtomicInteger initially 0, two threads each incrementAndGet once and then both join. Can the final get() return 1?',
      options: ['Yes, atomic operations still lose increments', 'No, the two atomic increments produce 2', 'Only if the threads use different CPU cores'],
      answer: 1, why: 'Each increment is a linearizable atomic update on the same AtomicInteger. Successful joins ensure both tasks finished before the final observation.',
    },
    frames: [
      f('Read an expected value', 'An illustrative CAS-based implementation: both threads initially expect 0. Actual implementations may use different atomic CPU instructions.', [['Thread A', 'expected = 0', true], ['Atomic count', '0'], ['Thread B', 'expected = 0', true]]),
      f('One update wins', 'A atomically changes 0 to 1. B cannot overwrite it using an expected value of 0.', [['Thread A', 'CAS 0 -> 1 succeeds', true], ['Atomic count', '1'], ['Thread B', 'CAS 0 -> 1 fails']]),
      f('Retry with the observed value', 'B reloads 1 and atomically changes 1 to 2. Contention may require repeated retries.', [['Thread A', 'finished'], ['Atomic count', '2', true], ['Thread B', 'CAS 1 -> 2 succeeds', true]]),
      f('Join before observing', 'Both completed atomic increments are reflected in the final count. This does not protect a separate multi-field invariant.', [['Main thread', 'join A; join B'], ['Atomic count', 'get() = 2', true], ['Limit', 'Only this atomic state transition']]),
    ],
  },
  proxy: {
    label: 'Move audit to an injected bean proxy',
    prediction: {
      prompt: 'Checkout calls a separate injected audit bean through its proxy. Audit uses REQUIRES_NEW and commits, then checkout rolls back. Does the audit row survive?',
      options: ['No, every nested Java call shares a physical transaction', 'Yes, the intercepted independent transaction already committed', 'Only if audit is private'],
      answer: 1, why: 'Crossing the separate proxy applies REQUIRES_NEW and creates an independent physical transaction. Its commit is not undone by the outer rollback; budget the extra connection.',
    },
    frames: [
      f('Begin checkout', 'The checkout proxy opens T1. The target holds the outer transaction connection.', [['Checkout proxy', 'T1 begins', true], ['Checkout target', 'Calls injected AuditService'], ['Audit proxy', 'Not entered yet']]),
      f('Cross the audit proxy', 'Unlike this.audit(), this call crosses another bean proxy. Its transaction interceptor sees REQUIRES_NEW.', [['Checkout T1', 'Suspended, resources held'], ['Audit proxy', 'Starts T2', true], ['Connections', 'C1 held + C2 for T2']]),
      f('Commit audit independently', 'Audit finishes successfully and T2 commits. Its connection can return to the pool.', [['Audit T2', 'COMMIT', true], ['Audit row', 'Committed'], ['Checkout T1', 'Resumed']]),
      f('Rollback checkout', 'A later checkout runtime failure rolls back T1 but not the already committed T2.', [['Checkout T1', 'ROLLBACK', true], ['Audit row', 'Still committed'], ['Tradeoff', 'Independent side effect + extra resource demand']]),
    ],
  },
  transactions: {
    label: 'Change inner propagation to REQUIRES_NEW',
    prediction: {
      prompt: 'An inner intercepted REQUIRES_NEW transaction rolls back; the outer catches its exception and has no other failure. Is the outer necessarily rollback-only?',
      options: ['Yes, all inner rollbacks poison the outer', 'No, these physical transactions are independent', 'Only if both methods use the same isolation'],
      answer: 1, why: 'REQUIRES_NEW rolls back its own transaction. Once resumed, the outer can commit if it was not otherwise marked rollback-only. A propagated uncaught exception could still make the outer roll back.',
    },
    frames: [
      f('Outer starts T1', 'The outer proxy obtains C1 for T1.', [['Outer', 'T1 active', true], ['Pool', 'C1 held'], ['Inner', 'not entered']]),
      f('Suspend and start T2', 'A separate proxy with REQUIRES_NEW obtains an independent transaction; C1 remains held.', [['Outer', 'T1 suspended'], ['Pool', 'C1 + C2 needed', true], ['Inner', 'T2 active']]),
      f('Inner failure rolls back T2', 'The inner interceptor rolls back T2. The outer catches the exception after resumption.', [['Outer', 'T1 resumed; catches failure'], ['Pool', 'C2 released'], ['Inner', 'T2 rolled back', true]]),
      f('Outer commits T1', 'With no other rollback-only marker or failure, T1 commits. Independent boundaries deliberately permit partial outcomes.', [['Outer', 'T1 COMMIT', true], ['Inner', 'T2 remains rolled back'], ['Tradeoff', 'Partial outcome + connection demand']]),
    ],
  },
};
