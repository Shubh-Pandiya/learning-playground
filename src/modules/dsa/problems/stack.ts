import type { Problem, Tone, Variant } from '../engine/types.ts';
import { DecisionTree, V, rc, tones } from '../engine/tracer.ts';

// ---------------------------------------------------------------------------
// Stack — LIFO for "most recent unmatched thing", monotonic stacks for "next greater/smaller".
// ---------------------------------------------------------------------------

/** Build predict options from a correct value + distractors, de-duplicated, keeping the answer index. */
function opts(correct: string, ...others: string[]): { options: string[]; answer: number } {
  const options = [correct];
  for (const o of others) if (!options.includes(o)) options.push(o);
  options.sort();
  return { options, answer: options.indexOf(correct) };
}

// ---------------------------------------------------------------------------

const validParentheses: Problem<{ s: string }> = {
  id: 'valid-parentheses',
  num: 20,
  title: 'Valid Parentheses',
  difficulty: 'Easy',
  category: 'stack',
  pattern: 'stack',
  statement:
    'A string contains only the bracket characters ()[]{}. Decide whether every opener is closed by the same kind of bracket, in the correct nesting order.',
  signals: ['"matching" / "balanced" brackets', 'nesting — the most recent opener must close first', 'single left-to-right scan', 'return True/False'],
  insight:
    'A closer must always match the MOST RECENT unmatched opener — that is exactly the top of a stack. Push openers, pop on a matching closer, and the string is valid iff the stack ends empty.',
  hints: [
    'When you see a closer, which opener does it have to pair with?',
    'The newest unmatched opener is the one that matters — what structure gives you "newest" in O(1)?',
    'Push openers; on a closer, the top must be its partner, otherwise fail. At the end the stack must be empty.',
  ],
  pitfall: 'Returning True after the loop without checking that the stack is empty — "((" would pass. Also popping from an empty stack on a leading closer.',
  backend: {
    title: 'Validating nested JSON / template tags in a streaming parser',
    detail:
      'A JSON or HTML/XML tokenizer in an API gateway validates payloads as bytes arrive: every { [ or <tag> is pushed, every } ] or </tag> must match the top. The stack depth is also how parsers enforce a max nesting limit to block "billion laughs"-style payloads.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def isValid(s):
    stack = []                                      @init
    pairs = {")": "(", "]": "[", "}": "{"}          @pairs
    for c in s:                                     @loop
        if c in pairs:                              @isClose
            if stack and stack[-1] == pairs[c]:     @match
                stack.pop()                         @pop
            else:
                return False                        @fail
        else:
            stack.append(c)                         @push
    return not stack                                @done
`,
  explain: {
    init: 'Holds openers that are still waiting for their closer — newest on top.',
    pairs: 'closer → opener, so a closer can look up which opener it needs.',
    match: 'A closer is only legal if the stack is non-empty AND the newest opener is its partner.',
    pop: 'That opener is now satisfied — remove it so the next closer sees the one below.',
    fail: 'Wrong kind of opener on top, or nothing to close: nesting is broken.',
    push: 'Openers wait on the stack until their closer arrives.',
    done: 'Valid only if no opener is left waiting.',
  },
  distractors: [
    { text: '    return True', why: 'Leftover openers (e.g. "((") mean the string is NOT valid — you must return `not stack`.' },
    { text: '            if stack[-1] == pairs[c]:', why: 'Crashes on a leading closer like ")" — check `stack` is non-empty first.' },
    { text: '            if stack[0] == pairs[c]:', why: 'stack[0] is the OLDEST opener; a closer must match the NEWEST one (stack[-1]).' },
  ],
  input: { s: '([]{})' },
  presets: [
    { label: 'wrong order', input: { s: '([)]' } },
    { label: 'leftover opener', input: { s: '(()' } },
    { label: 'leading closer', input: { s: ']()' } },
  ],
  validate: ({ s }) =>
    typeof s !== 'string' ? 'Expected { s: string }' : !/^[()[\]{}]*$/.test(s) ? 'Use only ()[]{} characters' : s.length > 24 ? 'Keep s ≤ 24 characters' : null,
  trace(t, { s }) {
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const matched: number[] = [];
    const openIdx: number[] = [];
    let i = -1;
    let bad = false;
    let predicts = 0;
    t.draw(() => {
      const tn: Record<number, Tone> = tones(matched, 'good');
      if (i >= 0 && i < s.length) tn[i] = bad ? 'bad' : 'active';
      const st: Record<number, Tone> = stack.length ? { [stack.length - 1]: bad ? 'bad' : 'active' } : {};
      return [
        V.text('s', s, { tones: tn }),
        V.stack('stack (unmatched openers, top = newest)', stack, { tones: st }),
        V.map('pairs (closer → opener)', pairs),
      ];
    });
    t.step('init', 'Empty stack: no opener is waiting yet.');
    t.step('pairs', 'Map each closer to the opener it needs, so a closer can ask "is my partner on top?".');
    for (i = 0; i < s.length; i++) {
      const c = s[i];
      t.step('loop', `Read s[${i}] = '${c}'.`, { i, c });
      if (c in pairs) {
        t.step('isClose', `'${c}' is a closer — it must match the newest waiting opener.`, { c, top: stack[stack.length - 1] ?? null });
        const ok = stack.length > 0 && stack[stack.length - 1] === pairs[c];
        if (predicts < 2 && stack.length) {
          predicts++;
          t.predict(`Top of the stack is '${stack[stack.length - 1]}'. Does '${c}' close it?`, ['Yes — pop it', 'No — return False'], ok ? 0 : 1, ok ? `'${c}' needs '${pairs[c]}', and that is exactly on top.` : `'${c}' needs '${pairs[c]}' but the newest opener is '${stack[stack.length - 1]}' — the nesting crosses.`);
        }
        if (ok) {
          t.step('match', `Top is '${pairs[c]}' — the partner of '${c}'.`, { c, top: stack[stack.length - 1] });
          stack.pop();
          matched.push(openIdx.pop()!, i);
          t.step('pop', `Pop it: that pair is closed. ${stack.length ? `'${stack[stack.length - 1]}' is now the newest waiting opener.` : 'Nothing is waiting now.'}`, { stack: [...stack] });
        } else {
          bad = true;
          t.step('match', stack.length ? `Top is '${stack[stack.length - 1]}', but '${c}' needs '${pairs[c]}'.` : `The stack is empty — '${c}' has nothing to close.`, { c, top: stack[stack.length - 1] ?? null });
          t.step('fail', 'Nesting is broken → return False.', { result: false });
          return false;
        }
      } else {
        stack.push(c);
        openIdx.push(i);
        t.step('push', `'${c}' is an opener: push it and wait for its closer.`, { stack: [...stack] });
      }
    }
    i = -1;
    const ok = stack.length === 0;
    bad = !ok;
    t.step('done', ok ? 'Every opener was closed in order and the stack is empty → True.' : `The scan ended with ${stack.length} opener(s) still waiting → False.`, { result: ok });
    return ok;
  },
};

// ---------------------------------------------------------------------------

type Op = (string | number)[];

const minStack: Problem<{ ops: Op[] }> = {
  id: 'min-stack',
  num: 155,
  title: 'Min Stack',
  difficulty: 'Medium',
  category: 'stack',
  pattern: 'design',
  statement:
    'Design a stack that supports push, pop, top and getMin, where getMin returns the smallest element currently in the stack — every operation must be O(1).',
  signals: ['"retrieve the minimum in constant time"', 'stack operations (push/pop/top)', 'design a class', 'state must survive pops'],
  insight:
    'The minimum only changes at push/pop, and pops undo pushes in reverse order. So store, next to every element, the minimum of everything at or below it: a parallel minStack whose top is always the current min.',
  hints: [
    'A single "current min" variable breaks when you pop the minimum — what was the min before it?',
    'Each stack depth has its own minimum that never changes while that depth exists.',
    'Keep a second stack: on push, append min(val, minStack top); on pop, pop both.',
  ],
  pitfall: 'Tracking one global min variable: after popping the minimum you cannot recover the previous minimum in O(1).',
  backend: {
    title: 'Undo-able "lowest price so far" in an order-book session',
    detail:
      'A trading or bidding service keeps a stack of tentative order edits per session with undo. Showing "best (lowest) ask in this session" must stay O(1) through undos — storing the running min alongside each pushed edit (the minStack) gives it instantly, the same trick used for O(1) max-in-window via two stacks in metrics pipelines.',
  },
  complexity: { time: 'O(1) per op', space: 'O(n)' },
  code: `
class MinStack:
    def __init__(self):
        self.stack = []                                 @init
        self.minStack = []                              @initMin
    def push(self, val):
        self.stack.append(val)                          @push
        val = min(val, self.minStack[-1] if self.minStack else val)  @pushMinCalc
        self.minStack.append(val)                       @pushMin
    def pop(self):
        self.stack.pop()                                @pop
        self.minStack.pop()                             @popMin
    def top(self):
        return self.stack[-1]                           @top
    def getMin(self):
        return self.minStack[-1]                        @getMin
`,
  explain: {
    initMin: 'minStack[i] = minimum of stack[0..i] — one entry per stack entry.',
    pushMinCalc: 'The new depth\'s min is either the new value or the min that was already below it.',
    pushMin: 'Always push to minStack, even when the min did not change, so the two stacks stay the same height.',
    popMin: 'Popping both restores the minimum that existed before this push — no searching.',
    getMin: 'The top of minStack is the min of the whole stack.',
  },
  distractors: [
    { text: '        if val <= self.minStack[-1]: self.minStack.append(val)', why: 'Only pushing smaller values makes the stacks different heights, so popping both no longer lines up (and it crashes on the first push).' },
    { text: '        return min(self.stack)', why: 'Scanning the stack is O(n); the whole point is O(1) getMin.' },
    { text: '        self.minStack.pop(0)', why: 'pop(0) removes the bottom (oldest) minimum and is O(n); it must mirror stack.pop() at the top.' },
  ],
  input: {
    ops: [['push', -2], ['push', 0], ['push', -3], ['getMin'], ['pop'], ['top'], ['getMin']],
  },
  presets: [
    { label: 'duplicate minimums', input: { ops: [['push', 2], ['push', 1], ['push', 1], ['pop'], ['getMin'], ['pop'], ['getMin']] } },
    { label: 'increasing pushes', input: { ops: [['push', 1], ['push', 2], ['push', 3], ['getMin'], ['top']] } },
  ],
  validate: ({ ops }) => {
    if (!Array.isArray(ops)) return 'Expected { ops: [["push", 3], ["getMin"], ...] }';
    if (ops.length > 20) return 'Keep ≤ 20 operations';
    let size = 0;
    for (const op of ops) {
      if (!Array.isArray(op) || typeof op[0] !== 'string') return 'Each op looks like ["push", 3] or ["pop"]';
      if (op[0] === 'push') {
        if (typeof op[1] !== 'number') return 'push needs a number';
        size++;
      } else if (op[0] === 'pop' || op[0] === 'top' || op[0] === 'getMin') {
        if (!size) return `${op[0]} on an empty stack`;
        if (op[0] === 'pop') size--;
      } else return `Unknown op ${op[0]} (use push, pop, top, getMin)`;
    }
    return null;
  },
  trace(t, { ops }) {
    const stack: number[] = [];
    const mins: number[] = [];
    const out: string[] = [];
    let cur = -1;
    let predicts = 0;
    t.draw(() => [
      V.chips('operations', ops.map((o) => `${o[0]}(${o.slice(1).join(', ')})`), { tones: cur >= 0 ? { [cur]: 'active' as Tone } : {} }),
      V.stack('stack', stack, { tones: stack.length ? { [stack.length - 1]: 'active' as Tone } : {} }),
      V.stack('minStack (min of everything at or below)', mins, { tones: mins.length ? { [mins.length - 1]: 'good' as Tone } : {} }),
      V.chips('returned', out),
    ]);
    t.step('init', 'Main stack holds the values.');
    t.step('initMin', 'minStack runs in parallel: entry i remembers the minimum of stack[0..i].');
    for (cur = 0; cur < ops.length; cur++) {
      const op = ops[cur];
      if (op[0] === 'push') {
        const val = op[1] as number;
        stack.push(val);
        t.step('push', `push(${val}): append ${val} to the main stack.`, { val });
        const nm = mins.length ? Math.min(val, mins[mins.length - 1]) : val;
        if (predicts < 2 && mins.length && cur > 0) {
          predicts++;
          const o = opts(String(nm), String(val), String(mins[mins.length - 1]));
          t.predict(`Current min is ${mins[mins.length - 1]}. What goes onto minStack for this push?`, o.options, o.answer, nm === val ? `${val} is smaller, so it becomes the new minimum.` : `${val} is not smaller than ${mins[mins.length - 1]}, so the minimum at this depth is still ${nm} — we push it again to keep the stacks aligned.`);
        }
        t.step('pushMinCalc', mins.length ? `min(${val}, ${mins[mins.length - 1]}) = ${nm}.` : `minStack is empty, so the min is ${val} itself.`, { val, newMin: nm });
        mins.push(nm);
        t.step('pushMin', `Push ${nm}: getMin is now ${nm} while this element is in the stack.`, { stack: [...stack], minStack: [...mins] });
      } else if (op[0] === 'pop') {
        const v = stack.pop();
        t.step('pop', `pop(): remove ${v} from the main stack.`, { popped: v });
        mins.pop();
        t.step('popMin', `Pop minStack too — its new top (${mins.length ? mins[mins.length - 1] : 'none'}) is the min from before ${v} was pushed.`, { minStack: [...mins] });
        if (predicts < 3 && mins.length && cur + 1 < ops.length && ops[cur + 1][0] === 'getMin') {
          predicts++;
          const o = opts(String(mins[mins.length - 1]), String(v), String(Math.min(...stack, v ?? 0)));
          t.predict('What will the next getMin() return?', o.options, o.answer, `minStack's top is ${mins[mins.length - 1]} — no search needed.`);
        }
      } else if (op[0] === 'top') {
        out.push(String(stack[stack.length - 1]));
        t.step('top', `top() → ${stack[stack.length - 1]}.`, { result: stack[stack.length - 1] });
      } else {
        out.push(String(mins[mins.length - 1]));
        t.step('getMin', `getMin() → ${mins[mins.length - 1]}, read straight off minStack's top in O(1).`, { result: mins[mins.length - 1] });
      }
    }
    cur = -1;
    t.step(null, `All operations done. Outputs: [${out.join(', ')}].`, { outputs: out.map(Number) });
    return out.map(Number);
  },
};

// ---------------------------------------------------------------------------

const OPS = new Set(['+', '-', '*', '/']);

const evalRPN: Problem<{ tokens: string[] }> = {
  id: 'evaluate-reverse-polish-notation',
  num: 150,
  title: 'Evaluate Reverse Polish Notation',
  difficulty: 'Medium',
  category: 'stack',
  pattern: 'stack',
  statement:
    'Evaluate an arithmetic expression written in postfix order (operands first, then the operator) using + − × ÷ on integers; division truncates toward zero.',
  signals: ['postfix / "reverse Polish"', 'operator applies to the two most recent values', 'no parentheses needed', 'evaluate left to right once'],
  insight:
    'In postfix, an operator always applies to the two most recently produced values — the top two of a stack. Pop them, combine, push the result back as a new operand.',
  hints: [
    'When you meet an operator, which two numbers does it use?',
    'The most recent two values… sounds like a stack.',
    'Pop b first, then a; push a op b. Order matters for − and ÷.',
  ],
  pitfall: 'Popping in the wrong order: the first pop is the RIGHT operand. "4 13 /" is 4 / 13, not 13 / 4. Also Python // floors negatives — use int(a / b) to truncate toward zero.',
  backend: {
    title: 'Evaluating feature-flag / alerting rule expressions',
    detail:
      'Rule engines (feature-flag targeting, Prometheus-style alert conditions, SQL query executors) compile infix expressions to postfix bytecode once, then evaluate it per request with a value stack: push field values, and each operator pops its operands and pushes the result — exactly this loop, and how stack-based VMs like the JVM work.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def evalRPN(tokens):
    stack = []                                  @init
    for c in tokens:                            @loop
        if c in "+-*/":                         @isOp
            b, a = stack.pop(), stack.pop()     @popTwo
            if c == "+": res = a + b            @add
            elif c == "-": res = a - b          @sub
            elif c == "*": res = a * b          @mul
            else: res = int(a / b)              @div
            stack.append(res)                   @pushRes
        else:
            stack.append(int(c))                @push
    return stack[0]                             @done
`,
  explain: {
    isOp: 'Operators consume values; numbers produce them.',
    popTwo: 'First pop is the RIGHT operand (it was pushed last).',
    div: 'int(a / b) truncates toward zero; Python // would floor −7 // 2 to −4.',
    pushRes: 'The result is itself an operand for a later operator.',
    done: 'A well-formed expression leaves exactly one value.',
  },
  distractors: [
    { text: '            a, b = stack.pop(), stack.pop()', why: 'Swaps the operands: the first pop is the right-hand value, so − and ÷ come out wrong.' },
    { text: '            else: res = a // b', why: 'Python // floors toward −∞ (−7 // 2 = −4); the problem wants truncation toward zero (−3).' },
    { text: '            stack.append(c)', why: 'Pushes the raw string — later arithmetic would concatenate or fail; convert with int(c).' },
  ],
  input: { tokens: ['4', '13', '5', '/', '+'] },
  presets: [
    { label: 'longer', input: { tokens: ['10', '6', '9', '3', '+', '-11', '*', '/', '*', '17', '+', '5', '+'] } },
    { label: 'negative division', input: { tokens: ['-7', '2', '/'] } },
  ],
  validate: ({ tokens }) => {
    if (!Array.isArray(tokens) || tokens.some((x) => typeof x !== 'string')) return 'Expected { tokens: string[] }';
    if (tokens.length > 15) return 'Keep ≤ 15 tokens';
    const st: number[] = [];
    for (const c of tokens) {
      if (OPS.has(c)) {
        if (st.length < 2) return `Operator ${c} needs two operands`;
        const b = st.pop()!;
        const a = st.pop()!;
        if (c === '/' && b === 0) return 'Division by zero';
        st.push(c === '+' ? a + b : c === '-' ? a - b : c === '*' ? a * b : Math.trunc(a / b));
      } else if (/^-?\d+$/.test(c)) st.push(Number(c));
      else return `Bad token ${c}`;
    }
    return st.length === 1 ? null : 'Expression must reduce to exactly one value';
  },
  trace(t, { tokens }) {
    const stack: number[] = [];
    let i = -1;
    let hot = 0;
    let predicts = 0;
    t.draw(() => {
      const st: Record<number, Tone> = {};
      for (let k = 0; k < hot && stack.length - 1 - k >= 0; k++) st[stack.length - 1 - k] = 'active';
      return [
        V.array('tokens', tokens, { pointers: { c: i }, tones: i >= 0 && i < tokens.length ? { [i]: (OPS.has(tokens[i]) ? 'warn' : 'info') as Tone } : {} }),
        V.stack('stack (operands)', stack, { tones: st }),
      ];
    });
    t.step('init', 'Empty operand stack.');
    for (i = 0; i < tokens.length; i++) {
      const c = tokens[i];
      hot = 0;
      t.step('loop', `Token '${c}'.`, { c });
      if (OPS.has(c)) {
        hot = 2;
        t.step('isOp', `'${c}' is an operator — it needs the two newest values (highlighted).`, { c });
        if (predicts < 1) {
          predicts++;
          t.predict(`For '${c}', which value is the LEFT operand a?`, [String(stack[stack.length - 2]) + ' (second from top)', String(stack[stack.length - 1]) + ' (top)'], 0, 'The top was pushed last, so it is the right operand b; the one below it is a.');
        }
        const b = stack.pop()!;
        const a = stack.pop()!;
        hot = 0;
        t.step('popTwo', `Pop b = ${b}, then a = ${a}.`, { a, b });
        const res = c === '+' ? a + b : c === '-' ? a - b : c === '*' ? a * b : Math.trunc(a / b);
        if (predicts < 3 && (c === '/' || c === '-' || predicts < 2)) {
          predicts++;
          const o = opts(String(res), String(c === '/' ? Math.floor(a / b) : c === '-' ? b - a : res + 1), String(c === '/' && a !== 0 ? Math.trunc(b / a) : res - 1));
          t.predict(`What is ${a} ${c} ${b}${c === '/' ? ' (truncated toward zero)' : ''}?`, o.options, o.answer, c === '/' ? `${a} / ${b} = ${(a / b).toFixed(2)}, truncated toward zero → ${res}.` : `${a} ${c} ${b} = ${res}.`);
        }
        const key = c === '+' ? 'add' : c === '-' ? 'sub' : c === '*' ? 'mul' : 'div';
        t.step(key, c === '/' ? `${a} / ${b} = ${(a / b).toFixed(2)} → truncate toward zero → ${res}.` : `${a} ${c} ${b} = ${res}.`, { a, b, res });
        stack.push(res);
        hot = 1;
        t.step('pushRes', `Push ${res} back: it is now an operand for whatever comes next.`, { stack: [...stack] });
      } else {
        stack.push(Number(c));
        hot = 1;
        t.step('push', `A number: push ${c} and wait for an operator.`, { stack: [...stack] });
      }
    }
    i = -1;
    hot = 1;
    t.step('done', `One value remains: ${stack[0]}.`, { result: stack[0] });
    return stack[0];
  },
};

// ---------------------------------------------------------------------------

const generateParentheses: Problem<{ n: number }> = {
  id: 'generate-parentheses',
  num: 22,
  title: 'Generate Parentheses',
  difficulty: 'Medium',
  category: 'stack',
  pattern: 'backtracking',
  statement: 'Given n pairs of parentheses, list every string of length 2n in which the parentheses are properly balanced.',
  signals: ['"generate all" combinations', 'small n', 'validity rule you can check while building (prefix constraint)', 'build a string one char at a time'],
  insight:
    'Build the string left to right. You may add "(" while fewer than n are open, and ")" only while closers < openers. Those two rules prune every invalid prefix, so every leaf is a valid answer.',
  hints: [
    'At every position you have only two choices: "(" or ")".',
    'When is adding "(" allowed? When is ")" allowed?',
    'Track open and closed counts; "(" if open < n, ")" if closed < open; record when both equal n.',
  ],
  pitfall: 'Allowing ")" whenever closed < n (instead of closed < open) generates prefixes like "())" that can never be balanced.',
  backend: {
    title: 'Enumerating valid API call sequences for contract tests',
    detail:
      'A property-based test generator for a resource API (e.g. open/close transactions, acquire/release locks) must enumerate every legal sequence of n begin/commit pairs. Backtracking with the same "can only close what is open" constraint generates exactly the legal traces without filtering millions of invalid ones.',
  },
  complexity: { time: 'O(4ⁿ / √n)', space: 'O(n) recursion' },
  code: `
def generateParenthesis(n):
    stack, res = [], []                         @init
    def backtrack(openN, closedN):
        if openN == closedN == n:               @base
            res.append("".join(stack))          @record
            return
        if openN < n:                           @canOpen
            stack.append("(")                   @pushOpen
            backtrack(openN + 1, closedN)       @recOpen
            stack.pop()                         @popOpen
        if closedN < openN:                     @canClose
            stack.append(")")                   @pushClose
            backtrack(openN, closedN + 1)       @recClose
            stack.pop()                         @popClose
    backtrack(0, 0)                             @start
    return res                                  @done
`,
  explain: {
    base: 'n openers and n closers placed — the prefix is a complete valid string.',
    canOpen: 'We may open as long as we have not used all n openers.',
    canClose: 'A closer is only legal if some opener is still unmatched.',
    popOpen: 'Undo the choice so the sibling branch starts from the same prefix (backtracking).',
    popClose: 'Undo again before returning to the caller.',
  },
  distractors: [
    { text: '        if closedN < n:', why: 'Lets you close before opening (e.g. ")("). The rule is closedN < openN.' },
    { text: '            backtrack(openN + 1, closedN + 1)', why: 'Adding one character changes only ONE count.' },
    { text: '        if openN + closedN == n:', why: 'A complete string has 2n characters, n of each — check openN == closedN == n.' },
  ],
  input: { n: 3 },
  presets: [
    { label: 'n = 1', input: { n: 1 } },
    { label: 'n = 2', input: { n: 2 } },
  ],
  validate: ({ n }) => (typeof n !== 'number' || !Number.isInteger(n) ? 'Expected { n: integer }' : n < 1 || n > 4 ? 'Use 1 ≤ n ≤ 4' : null),
  trace(t, { n }) {
    const stack: string[] = [];
    const res: string[] = [];
    const tree = new DecisionTree();
    const asked = new Set<string>();
    t.draw(() => [
      V.decision('choices (each node = current prefix)', tree),
      V.stack('stack (current prefix, bottom → top)', stack, { tones: stack.length ? { [stack.length - 1]: 'active' as Tone } : {} }),
      V.chips('res', res, { tones: tones(res.map((_, k) => k), 'good') }),
    ]);
    t.step('init', `Start with an empty prefix. We need ${n} "(" and ${n} ")".`, { n });
    const root = tree.add(null, '""', 'active');
    tree.current = root;
    t.step('start', 'Call backtrack(0, 0): nothing placed yet.', { openN: 0, closedN: 0 });
    const bt = (openN: number, closedN: number, node: string) => {
      tree.current = node;
      const prefix = stack.join('') || '""';
      t.step('base', `Prefix ${prefix}: open = ${openN}, closed = ${closedN}.`, { openN, closedN, n });
      if (openN === n && closedN === n) {
        res.push(stack.join(''));
        tree.tone(node, 'good');
        t.step('record', `Both counts hit ${n} — "${stack.join('')}" is balanced. Record it.`, { res: [...res] });
        return;
      }
      const canO = openN < n;
      const canC = closedN < openN;
      const kind = canO && canC ? 'both' : canO ? 'open' : 'close';
      if (!asked.has(kind) && openN > 0) {
        asked.add(kind);
        t.predict(`From ${prefix} (open ${openN}, closed ${closedN}, n ${n}), which characters may we add?`, ['only "("', 'only ")"', 'both'], kind === 'open' ? 0 : kind === 'close' ? 1 : 2, kind === 'open' ? 'closed == open, so a ")" would have nothing to close.' : kind === 'close' ? `All ${n} openers are used — only closers remain.` : 'Openers are left AND some opener is unmatched — both branches are legal.');
      }
      t.step('canOpen', canO ? `open ${openN} < ${n}: we may add "(".` : `open == ${n}: no openers left, skip this branch.`, { openN, n });
      if (canO) {
        stack.push('(');
        const child = tree.add(node, stack.join(''), 'active');
        t.step('pushOpen', `Choose "(" → prefix ${stack.join('')}, recurse.`, { stack: stack.join('') });
        bt(openN + 1, closedN, child);
        tree.current = node;
        tree.tone(child, tree.nodes.find((x) => x.id === child)?.tone === 'good' ? 'good' : 'muted');
        stack.pop();
        t.step('popOpen', `Back at ${prefix}: undo "(" so the next choice starts from the same prefix.`, { openN, closedN });
      }
      t.step('canClose', canC ? `closed ${closedN} < open ${openN}: an opener is unmatched, so ")" is legal.` : `closed ${closedN} == open ${openN}: a ")" would close nothing — prune.`, { openN, closedN });
      if (canC) {
        stack.push(')');
        const child = tree.add(node, stack.join(''), 'active');
        t.step('pushClose', `Choose ")" → prefix ${stack.join('')}, recurse.`, { stack: stack.join('') });
        bt(openN, closedN + 1, child);
        tree.current = node;
        tree.tone(child, tree.nodes.find((x) => x.id === child)?.tone === 'good' ? 'good' : 'muted');
        stack.pop();
        t.step('popClose', `Back at ${prefix}: undo ")" and return to the caller.`, { openN, closedN });
      }
    };
    bt(0, 0, root);
    tree.current = null;
    t.step('done', `${res.length} balanced strings: ${res.join(', ')}.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const dailyTemperatures: Problem<{ temperatures: number[] }> = {
  id: 'daily-temperatures',
  num: 739,
  title: 'Daily Temperatures',
  difficulty: 'Medium',
  category: 'stack',
  pattern: 'monotonic-stack',
  statement:
    'For each day\'s temperature, report how many days you must wait until a strictly warmer day; use 0 if none comes.',
  signals: ['"next greater element" / "how long until warmer"', 'answer per index looks to the right', 'O(n) wanted over O(n²)', 'distance between indices'],
  insight:
    'Keep a stack of days still waiting for a warmer day; their temperatures are decreasing from bottom to top. A new warmer day resolves every cooler day on top at once — each index is pushed and popped once, so O(n).',
  hints: [
    'Brute force scans right from every day. Which days are still "unanswered" when you reach day i?',
    'Unanswered days form a decreasing sequence — why can a warmer one never be stuck below a colder one?',
    'Stack of (temp, index). While today is warmer than the top, pop it and set res[index] = i − index.',
  ],
  pitfall: 'Using an if instead of a while: one warm day can answer SEVERAL waiting days, so you must keep popping.',
  backend: {
    title: '"Time until next higher load" for capacity alerts',
    detail:
      'A capacity-planning job scans per-minute CPU samples and, for each sample, needs the wait until the next higher reading (or next price uptick in a pricing service). A monotonic stack of unresolved samples answers all of them in one O(n) pass instead of an O(n²) look-ahead over millions of datapoints.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def dailyTemperatures(temperatures):
    res = [0] * len(temperatures)               @init
    stack = []  # [temp, index], decreasing     @initStack
    for i, t in enumerate(temperatures):        @loop
        while stack and t > stack[-1][0]:       @while
            stackT, stackInd = stack.pop()      @pop
            res[stackInd] = i - stackInd        @answer
        stack.append([t, i])                    @push
    return res                                  @done
`,
  explain: {
    initStack: 'Days still waiting for a warmer day. Temperatures decrease from bottom to top.',
    while: 'Today is the first warmer day for every cooler day on top — resolve them all.',
    answer: 'Distance from the waiting day to today.',
    push: 'Today now waits for its own warmer day. Pushing it keeps the stack decreasing.',
    done: 'Days never popped keep 0 — no warmer day came.',
  },
  distractors: [
    { text: '        if stack and t > stack[-1][0]:', why: 'Only resolves one waiting day; a hot day must pop every cooler day on top — use while.' },
    { text: '        while stack and t >= stack[-1][0]:', why: 'An EQUAL temperature is not warmer; >= gives wrong (too-early) answers.' },
    { text: '            res[stackInd] = t - stackT', why: 'The answer is a number of DAYS (index distance), not a temperature difference.' },
  ],
  input: { temperatures: [73, 74, 75, 71, 69, 72, 76, 73] },
  presets: [
    { label: 'strictly increasing', input: { temperatures: [30, 40, 50, 60] } },
    { label: 'strictly decreasing', input: { temperatures: [60, 50, 40, 30] } },
  ],
  validate: ({ temperatures }) =>
    !Array.isArray(temperatures) || temperatures.some((x) => typeof x !== 'number') ? 'Expected { temperatures: number[] }' : temperatures.length > 14 ? 'Keep ≤ 14 days' : null,
  trace(t, { temperatures: temps }) {
    const res = temps.map(() => 0);
    const stack: [number, number][] = [];
    let i = -1;
    let popped = -1;
    const answered: number[] = [];
    let predicts = 0;
    t.draw(() => {
      const tn: Record<number, Tone> = { ...tones(answered, 'good'), ...tones(stack.map((s) => s[1]), 'info') };
      if (popped >= 0) tn[popped] = 'warn';
      if (i >= 0 && i < temps.length) tn[i] = 'active';
      return [
        V.array('temperatures', temps, { pointers: { i }, tones: tn }),
        V.stack('stack (temp@index, decreasing)', stack.map(([tt, k]) => `${tt}@${k}`), { tones: stack.length ? { [stack.length - 1]: 'active' as Tone } : {} }),
        V.array('res (days to wait)', res, { tones: tones(answered, 'good') }),
      ];
    });
    t.step('init', 'res defaults to 0 for every day — days never answered stay 0.');
    t.step('initStack', 'The stack will hold days still waiting for a warmer day.');
    for (i = 0; i < temps.length; i++) {
      const cur = temps[i];
      popped = -1;
      t.step('loop', `Day ${i}: ${cur}°.`, { i, t: cur });
      if (stack.length) {
        let willPop = 0;
        for (let k = stack.length - 1; k >= 0 && cur > stack[k][0]; k--) willPop++;
        if (predicts < 3 && ((predicts === 0 && willPop === 0) || (predicts > 0 && willPop >= 2) || (predicts === 1 && willPop === 1))) {
          predicts++;
          const o = opts(String(willPop), '0', '1', String(stack.length));
          t.predict(`Stack top is ${stack[stack.length - 1][0]}°. How many waiting days will ${cur}° pop?`, o.options, o.answer, willPop ? `${cur}° is warmer than the top ${willPop} day(s); it stops at the first day that is ≥ ${cur}° (or an empty stack).` : `${cur}° is not warmer than ${stack[stack.length - 1][0]}°, so nothing resolves — it just joins the waiting stack.`);
        }
      }
      while (stack.length && cur > stack[stack.length - 1][0]) {
        t.step('while', `${cur}° > top ${stack[stack.length - 1][0]}° — today answers that day.`, { t: cur, top: stack[stack.length - 1][0] });
        const [st, si] = stack.pop()!;
        popped = si;
        t.step('pop', `Pop day ${si} (${st}°).`, { stackT: st, stackInd: si });
        res[si] = i - si;
        answered.push(si);
        t.step('answer', `res[${si}] = ${i} − ${si} = ${res[si]} day(s).`, { stackInd: si, 'res[stackInd]': res[si] });
        popped = -1;
      }
      t.step('while', stack.length ? `${cur}° is not warmer than top ${stack[stack.length - 1][0]}° — stop popping.` : 'Stack is empty — nothing else is waiting.', { t: cur });
      stack.push([cur, i]);
      t.step('push', `Push ${cur}@${i}: day ${i} now waits for a warmer day. Stack stays decreasing.`, { stack: stack.map(([a, b]) => `${a}@${b}`) });
    }
    i = -1;
    t.step('done', `Days still on the stack (${stack.map((s) => s[1]).join(', ') || 'none'}) never saw a warmer day and keep 0.`, { res });
    return res;
  },
};

// ---------------------------------------------------------------------------

const carFleet: Problem<{ target: number; position: number[]; speed: number[] }> = {
  id: 'car-fleet',
  num: 853,
  title: 'Car Fleet',
  difficulty: 'Medium',
  category: 'stack',
  pattern: 'monotonic-stack',
  statement:
    'Cars on a one-lane road drive toward a target; a faster car that catches a slower one ahead must slow down and travel with it as one fleet. Given each car\'s start position and speed, count how many fleets reach the target.',
  signals: ['cannot overtake → blocked by the car ahead', '"fleets" merge', 'arrival time = (target − pos) / speed', 'sort by position'],
  insight:
    'Process cars from closest-to-target backwards and compare arrival times. If a car would arrive no later than the fleet ahead of it, it catches up and merges (pop it); otherwise it leads a new fleet. The stack holds strictly increasing arrival times.',
  hints: [
    'Only the car directly ahead can block you — so order the cars by position.',
    'Instead of simulating, compute when each car would arrive if alone.',
    'Walk from the front; push each time; if it is ≤ the time below it, it merged — pop it.',
  ],
  pitfall: 'Sorting ascending (back to front): a car is blocked by the one AHEAD, so you must process from the car nearest the target.',
  backend: {
    title: 'Coalescing retries behind a slow upstream',
    detail:
      'In a request pipeline (e.g. a single-connection DB replica or an ordered Kafka partition), a later fast request cannot complete before an earlier slow one — it gets batched behind it. Computing each request\'s standalone finish time and merging those that would finish earlier than the one ahead tells you how many distinct completion batches (fleets) the consumer sees.',
  },
  complexity: { time: 'O(n log n)', space: 'O(n)' },
  code: `
def carFleet(target, position, speed):
    pair = sorted(zip(position, speed), reverse=True)    @sort
    stack = []  # arrival times of fleet leaders          @init
    for p, s in pair:                                     @loop
        stack.append((target - p) / s)                    @push
        if len(stack) >= 2 and stack[-1] <= stack[-2]:    @check
            stack.pop()                                   @merge
    return len(stack)                                     @done
`,
  explain: {
    sort: 'Closest to the target first — each car can only be blocked by the car before it in this order.',
    push: 'Time to reach the target if the road were empty.',
    check: 'Arriving no later than the fleet ahead means it catches up before (or at) the target.',
    merge: 'It joins that fleet and adopts its (slower) time, so it is not a new fleet.',
    done: 'Each remaining time is the leader of a distinct fleet.',
  },
  distractors: [
    { text: '    pair = sorted(zip(position, speed))', why: 'Ascending order processes the back cars first — but a car is only blocked by cars AHEAD of it.' },
    { text: '        if len(stack) >= 2 and stack[-1] < stack[-2]:', why: 'Arriving at exactly the same time also counts as one fleet — the comparison must be <=.' },
    { text: '        stack.append(s / (target - p))', why: 'That is the inverse of time; arrival time is distance / speed.' },
  ],
  input: { target: 12, position: [10, 8, 0, 5, 3], speed: [2, 4, 1, 1, 3] },
  presets: [
    { label: 'one car', input: { target: 10, position: [3], speed: [3] } },
    { label: 'all merge', input: { target: 100, position: [0, 2, 4], speed: [4, 2, 1] } },
  ],
  validate: ({ target, position, speed }) => {
    if (typeof target !== 'number' || !Array.isArray(position) || !Array.isArray(speed)) return 'Expected { target, position: number[], speed: number[] }';
    if (position.length !== speed.length) return 'position and speed must have the same length';
    if (position.length < 1 || position.length > 10) return 'Use 1–10 cars';
    if (new Set(position).size !== position.length) return 'Positions must be unique';
    if (position.some((p) => p < 0 || p >= target)) return 'Positions must be in [0, target)';
    if (speed.some((s) => !(s > 0))) return 'Speeds must be positive';
    return null;
  },
  trace(t, { target, position, speed }) {
    let pair: [number, number][] = [];
    const stack: number[] = [];
    const leaders: number[] = [];
    let i = -1;
    let merged = -1;
    let predicts = 0;
    const tm = (p: number, s: number) => (target - p) / s;
    t.draw(() => {
      const tn: Record<number, Tone> = tones(leaders, 'good');
      if (merged >= 0) tn[merged] = 'muted';
      if (i >= 0 && i < pair.length) tn[i] = 'active';
      return [
        V.array(pair.length ? 'cars (closest to target first) — pos/speed' : 'cars — pos/speed', pair.length ? pair.map(([p, s]) => `${p}/${s}`) : position.map((p, k) => `${p}/${speed[k]}`), { pointers: { car: i }, tones: tn }),
        pair.length > 0 && V.array('arrival time if alone', pair.map(([p, s], k) => (k <= i ? tm(p, s) : '·')), { tones: tn }),
        V.stack('stack (fleet arrival times, increasing toward bottom)', stack, { tones: stack.length ? { [stack.length - 1]: 'active' as Tone } : {} }),
      ];
    });
    t.step(null, `Target is at ${target}. Cars are shown as position/speed.`, { target });
    pair = position.map((p, k) => [p, speed[k]] as [number, number]).sort((a, b) => b[0] - a[0]);
    t.step('sort', 'Sort by position, closest to the target first: a car can only be held up by the car directly ahead of it.', { pair: pair.map(([p, s]) => [p, s]) });
    t.step('init', 'The stack will hold one arrival time per fleet leader.');
    for (i = 0; i < pair.length; i++) {
      const [p, s] = pair[i];
      merged = -1;
      t.step('loop', `Car at ${p} with speed ${s}.`, { p, s });
      const time = tm(p, s);
      if (predicts < 3 && stack.length) {
        predicts++;
        const joins = time <= stack[stack.length - 1];
        t.predict(`Alone it arrives at t = ${+time.toFixed(2)}; the fleet ahead arrives at t = ${+stack[stack.length - 1].toFixed(2)}. Does it join that fleet?`, ['Yes — it catches up (pop)', 'No — it leads a new fleet'], joins ? 0 : 1, joins ? 'It would arrive no later than the car ahead, so it must catch it before the target and slow down.' : 'It arrives later than the fleet ahead, so it never catches it — it is a separate fleet.');
      }
      stack.push(time);
      t.step('push', `Time if alone: (${target} − ${p}) / ${s} = ${+time.toFixed(3)}.`, { time });
      if (stack.length >= 2 && stack[stack.length - 1] <= stack[stack.length - 2]) {
        t.step('check', `${+time.toFixed(3)} ≤ ${+stack[stack.length - 2].toFixed(3)}: it would reach the target no later than the fleet ahead → it catches up.`, { time, ahead: stack[stack.length - 2] });
        stack.pop();
        merged = i;
        t.step('merge', 'Pop it: it now drives with that fleet, so no new fleet.', { fleets: stack.length });
      } else {
        leaders.push(i);
        t.step('check', stack.length >= 2 ? `${+time.toFixed(3)} > ${+stack[stack.length - 2].toFixed(3)}: it is slower to arrive than the fleet ahead, so it leads a new fleet.` : 'First car: it leads a fleet.', { time, fleets: stack.length });
      }
    }
    i = -1;
    t.step('done', `${stack.length} fleet(s) reach the target.`, { result: stack.length });
    return stack.length;
  },
};

// ---------------------------------------------------------------------------

const largestRectangle: Problem<{ heights: number[] }> = {
  id: 'largest-rectangle-in-histogram',
  num: 84,
  title: 'Largest Rectangle in Histogram',
  difficulty: 'Hard',
  category: 'stack',
  pattern: 'monotonic-stack',
  statement: 'Bars of width 1 stand side by side with the given heights. Find the area of the largest axis-aligned rectangle that fits inside the histogram.',
  signals: ['"largest rectangle" under bars', 'each bar extends until a shorter bar on each side', 'next smaller element to the left/right', 'O(n) for n up to 10⁵'],
  insight:
    'A bar\'s rectangle stretches until a shorter bar blocks it. Keep an increasing stack of (start, height); when a shorter bar arrives, every taller bar on top has found its right edge — pop it and measure. The shorter bar inherits the popped start, because it can extend left over those taller bars.',
  hints: [
    'For each bar, how far can a rectangle of exactly its height extend?',
    'The right boundary of a bar is the first shorter bar after it — a "next smaller element" question.',
    'Increasing stack of (start, height). On a shorter bar, pop and compute height × (i − start); push the new bar with the leftmost popped start.',
  ],
  pitfall: 'Forgetting the bars still on the stack at the end — they extend all the way to the right edge (width n − start).',
  backend: {
    title: 'Longest window of guaranteed capacity in a cluster',
    detail:
      'Given per-minute free capacity across a cluster, a batch scheduler wants the time window × guaranteed capacity block that is largest (e.g. to place a big Spark job). Each minute is a bar; the best block is the largest rectangle — the monotonic stack finds it in one pass over the capacity timeline.',
  },
  complexity: { time: 'O(n)', space: 'O(n)' },
  code: `
def largestRectangleArea(heights):
    maxArea = 0                                         @init
    stack = []  # (start index, height), increasing     @initStack
    for i, h in enumerate(heights):                     @loop
        start = i                                       @start
        while stack and stack[-1][1] > h:               @while
            index, height = stack.pop()                 @pop
            maxArea = max(maxArea, height * (i - index))  @area
            start = index                               @extend
        stack.append((start, h))                        @push
    for i, h in stack:                                  @tail
        maxArea = max(maxArea, h * (len(heights) - i))  @tailArea
    return maxArea                                      @done
`,
  explain: {
    while: 'A shorter bar is the right wall for every taller bar on top.',
    area: 'The popped bar spans from its start up to (not including) i.',
    extend: 'The new, shorter bar can reach back over the taller bars it popped.',
    push: 'Stack stays increasing in height.',
    tail: 'Bars never popped reach the right end of the histogram.',
  },
  distractors: [
    { text: '            maxArea = max(maxArea, height * (i - index + 1))', why: 'Bar i is shorter and NOT part of this rectangle; the width is i − index.' },
    { text: '        stack.append((i, h))', why: 'Loses the extension: the new bar can stretch left over the taller bars it popped, so push (start, h).' },
    { text: '        while stack and stack[-1][1] < h:', why: 'Pops on TALLER bars — the stack must be increasing, popping when a SHORTER bar arrives.' },
  ],
  input: { heights: [2, 1, 5, 6, 2, 3] },
  presets: [
    { label: 'increasing', input: { heights: [1, 2, 3, 4, 5] } },
    { label: 'all equal', input: { heights: [3, 3, 3, 3] } },
  ],
  validate: ({ heights }) =>
    !Array.isArray(heights) || heights.some((x) => typeof x !== 'number' || x < 0 || !Number.isInteger(x))
      ? 'Expected { heights: non-negative integers }'
      : heights.length < 1 || heights.length > 10
        ? 'Use 1–10 bars'
        : Math.max(...heights) > 8
          ? 'Keep heights ≤ 8 so the histogram fits'
          : null,
  trace(t, { heights }) {
    const n = heights.length;
    const H = Math.max(1, ...heights);
    let maxArea = 0;
    const stack: [number, number][] = [];
    let i = -1;
    let cur: { s: number; e: number; h: number } | null = null;
    let best: { s: number; e: number; h: number } | null = null;
    let predicts = 0;
    t.draw(() => {
      const cells = Array.from({ length: H }, (_, r) => heights.map((h) => (h >= H - r ? '■' : '')));
      const tn: Record<string, Tone> = {};
      const paint = (rect: { s: number; e: number; h: number } | null, tone: Tone) => {
        if (!rect) return;
        for (let c = rect.s; c <= rect.e; c++) for (let r = H - rect.h; r < H; r++) tn[rc(r, c)] = tone;
      };
      paint(best, 'good');
      paint(cur, 'active');
      return [
        V.grid('histogram', cells, { tones: tn, rowLabels: cells.map((_, r) => H - r), colLabels: heights.map((_, c) => c), caption: 'green = best so far, highlighted = rectangle being measured' }),
        V.array('heights', heights, { pointers: { i: i < n ? i : -1 }, tones: tones(stack.map((s) => s[0]), 'info') }),
        V.stack('stack (start, height) — increasing', stack.map(([s, h]) => `(${s}, ${h})`), { tones: stack.length ? { [stack.length - 1]: 'active' as Tone } : {} }),
      ];
    });
    t.step('init', 'maxArea = 0.');
    t.step('initStack', 'The stack holds bars whose right edge is not known yet, with heights increasing.');
    for (i = 0; i < n; i++) {
      const h = heights[i];
      cur = null;
      t.step('loop', `Bar ${i}, height ${h}.`, { i, h });
      let start = i;
      t.step('start', `By default this bar's rectangle starts at its own index ${i}.`, { start });
      if (predicts < 1 && stack.length && stack[stack.length - 1][1] > h) {
        let k = 0;
        for (let j = stack.length - 1; j >= 0 && stack[j][1] > h; j--) k++;
        predicts++;
        const o = opts(String(k), '0', '1', String(stack.length));
        t.predict(`Height ${h} arrives. How many bars get popped?`, o.options, o.answer, `Every bar on the stack taller than ${h} has found its right wall: ${k} of them.`);
      }
      while (stack.length && stack[stack.length - 1][1] > h) {
        t.step('while', `Top bar height ${stack[stack.length - 1][1]} > ${h}: bar ${i} is its right wall.`, { h, top: stack[stack.length - 1][1] });
        const [index, height] = stack.pop()!;
        cur = { s: index, e: i - 1, h: height };
        t.step('pop', `Pop (${index}, ${height}): its rectangle spans columns ${index}…${i - 1}.`, { index, height });
        const area = height * (i - index);
        if (predicts < 3) {
          predicts++;
          const o = opts(String(area), String(height * (i - index + 1)), String(height));
          t.predict(`Area of the popped rectangle (height ${height}, from ${index} up to ${i})?`, o.options, o.answer, `${height} × (${i} − ${index}) = ${area}; bar ${i} itself is shorter and excluded.`);
        }
        if (area > maxArea) {
          maxArea = area;
          best = { ...cur };
        }
        t.step('area', `Area ${height} × (${i} − ${index}) = ${area}. maxArea = ${maxArea}.`, { area, maxArea });
        start = index;
        t.step('extend', `Bar ${i} (height ${h}) can stretch left under the popped bar, so its start moves to ${index}.`, { start });
        cur = null;
      }
      stack.push([start, h]);
      t.step('push', `Push (${start}, ${h}). The stack is still increasing.`, { stack: stack.map(([s, hh]) => [s, hh]) });
    }
    cur = null;
    t.step('tail', 'End of bars. Whatever is left was never blocked on the right — it extends to the end.', { n });
    for (const [s, h] of stack) {
      cur = { s, e: n - 1, h };
      const area = h * (n - s);
      if (area > maxArea) {
        maxArea = area;
        best = { ...cur };
      }
      t.step('tailArea', `(${s}, ${h}) spans ${s}…${n - 1}: ${h} × ${n - s} = ${area}. maxArea = ${maxArea}.`, { start: s, h, area, maxArea });
    }
    cur = null;
    i = n;
    t.step('done', `Largest rectangle area is ${maxArea}.`, { result: maxArea });
    return maxArea;
  },
};

export const problems: Problem[] = [
  validParentheses,
  minStack,
  evalRPN,
  generateParentheses,
  dailyTemperatures,
  carFleet,
  largestRectangle,
];

export const variants: Variant[] = [
  {
    id: 'validate-template-tags',
    title: 'Validate nested template tags',
    statement:
      'A template string contains tags like {{#if}}, {{/if}}, {{#each}}, {{/each}} mixed with text. Return whether every block tag is closed by the matching closer in proper nesting order.',
    pattern: 'stack',
    nearest: 'valid-parentheses',
    signals: ['open/close tokens that must nest', '"properly closed"', 'most recent open block closes first'],
    approach: 'Tokenize; push the name on every opening tag; on a closing tag the stack top must have the same name — pop it, else invalid. Valid iff the stack ends empty.',
    backend: 'Linting Handlebars/Jinja email templates in a CI step, or validating nested BEGIN/COMMIT savepoints in a SQL migration.',
  },
  {
    id: 'next-higher-latency',
    title: 'Next slower request',
    statement:
      'Given a list of request latencies in arrival order, for each request return the index of the next request that was strictly slower, or −1 if none.',
    pattern: 'monotonic-stack',
    nearest: 'daily-temperatures',
    signals: ['"next greater" to the right', 'one answer per index', 'n large — O(n²) too slow'],
    approach: 'Decreasing stack of indices still waiting. For each latency, pop while it is larger than the top, assigning the current index as their answer; then push the current index.',
    backend: 'Annotating a trace log so each span links to the next regression, or building "next price increase" alerts in a pricing service.',
  },
  {
    id: 'simplify-file-path',
    title: 'Canonicalize a storage path',
    statement:
      'Given an absolute object-store path that may contain "//", "." and ".." segments, return its canonical form (no dots, single slashes, no trailing slash).',
    pattern: 'stack',
    nearest: 'evaluate-reverse-polish-notation',
    signals: ['".." undoes the most recent segment', 'process tokens left to right', 'rebuild a result from remaining items'],
    approach: 'Split on "/"; skip "" and "."; on ".." pop if non-empty; otherwise push the segment. Join the stack with "/".',
    backend: 'Normalizing S3 keys / URL paths in a gateway before authorization so "../" tricks cannot escape a tenant prefix.',
  },
];
