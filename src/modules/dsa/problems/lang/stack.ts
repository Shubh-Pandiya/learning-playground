import type { LangPack } from '../../engine/types.ts';

// Java / C++ versions of the stack problems. See problems/AUTHORING.md → "Languages".
export const langs: Record<string, LangPack> = {
  'valid-parentheses': {
    java: `
public boolean isValid(String s) {
    Deque<Character> stack = new ArrayDeque<>();                              @init
    Map<Character, Character> pairs = Map.of(')', '(', ']', '[', '}', '{');   @pairs
    for (char c : s.toCharArray()) {                                          @loop
        if (pairs.containsKey(c)) {                                           @isClose
            if (!stack.isEmpty() && stack.peek().equals(pairs.get(c))) {      @match
                stack.pop();                                                  @pop
            } else {
                return false;                                                 @fail
            }
        } else {
            stack.push(c);                                                    @push
        }
    }
    return stack.isEmpty();                                                   @done
}
`,
    cpp: `
bool isValid(string s) {
    vector<char> stack;                                                       @init
    unordered_map<char, char> pairs = {{')', '('}, {']', '['}, {'}', '{'}};   @pairs
    for (char c : s) {                                                        @loop
        if (pairs.count(c)) {                                                 @isClose
            if (!stack.empty() && stack.back() == pairs[c]) {                 @match
                stack.pop_back();                                             @pop
            } else {
                return false;                                                 @fail
            }
        } else {
            stack.push_back(c);                                               @push
        }
    }
    return stack.empty();                                                     @done
}
`,
    distractors: [
      { java: '    return true;', cpp: '    return true;' },
      { java: '            if (stack.peek().equals(pairs.get(c))) {', cpp: '            if (stack.back() == pairs[c]) {' },
      { java: '            if (stack.peekLast().equals(pairs.get(c))) {', cpp: '            if (stack[0] == pairs[c]) {' },
    ],
    gotchas: {
      java: [
        'Use `ArrayDeque` as the stack, not the legacy synchronized `Stack`; `peek()` on an empty `ArrayDeque` returns `null`, so `stack.peek().equals(...)` throws without the `isEmpty()` guard.',
        '`stack.peek() == pairs.get(c)` compares two boxed `Character` references — it only works because ASCII chars are cached; use `.equals` or unbox to `char`.',
      ],
      cpp: ['`stack.back()` on an empty `vector` is undefined behaviour (no exception, just garbage or a crash) — the `!stack.empty()` check is mandatory.'],
    },
  },

  'min-stack': {
    java: `
class MinStack {
    private final Deque<Integer> stack = new ArrayDeque<>();                  @init
    private final Deque<Integer> minStack = new ArrayDeque<>();               @initMin
    public void push(int val) {
        stack.push(val);                                                      @push
        val = Math.min(val, minStack.isEmpty() ? val : minStack.peek());      @pushMinCalc
        minStack.push(val);                                                   @pushMin
    }
    public void pop() {
        stack.pop();                                                          @pop
        minStack.pop();                                                       @popMin
    }
    public int top() {
        return stack.peek();                                                  @top
    }
    public int getMin() {
        return minStack.peek();                                               @getMin
    }
}
`,
    cpp: `
class MinStack {
    vector<int> stack;                                                        @init
    vector<int> minStack;                                                     @initMin
public:
    void push(int val) {
        stack.push_back(val);                                                 @push
        val = min(val, minStack.empty() ? val : minStack.back());             @pushMinCalc
        minStack.push_back(val);                                              @pushMin
    }
    void pop() {
        stack.pop_back();                                                     @pop
        minStack.pop_back();                                                  @popMin
    }
    int top() {
        return stack.back();                                                  @top
    }
    int getMin() {
        return minStack.back();                                               @getMin
    }
};
`,
    distractors: [
      { java: '        if (val <= minStack.peek()) minStack.push(val);', cpp: '        if (val <= minStack.back()) minStack.push_back(val);' },
      { java: '        return Collections.min(stack);', cpp: '        return *min_element(stack.begin(), stack.end());' },
      { java: '        minStack.removeLast();', cpp: '        minStack.erase(minStack.begin());' },
    ],
    gotchas: {
      java: [
        '`ArrayDeque.push` adds at the FRONT, so `peek()`/`pop()` are the top and `removeLast()` is the bottom.',
        'In the "push only when ≤ min" variant, `stack.peek() == minStack.peek()` compares boxed `Integer`s by reference and breaks outside −128…127 — use `.equals`.',
      ],
      cpp: ['`std::stack::pop()` / `vector::pop_back()` return `void` — read `top()` / `back()` first; calling either on an empty container is undefined behaviour.'],
    },
  },

  'evaluate-reverse-polish-notation': {
    java: `
public int evalRPN(String[] tokens) {
    Deque<Integer> stack = new ArrayDeque<>();                @init
    for (String c : tokens) {                                 @loop
        if ("+-*/".contains(c)) {                             @isOp
            int b = stack.pop(), a = stack.pop();             @popTwo
            int res;
            if (c.equals("+")) res = a + b;                   @add
            else if (c.equals("-")) res = a - b;              @sub
            else if (c.equals("*")) res = a * b;              @mul
            else res = a / b;                                 @div
            stack.push(res);                                  @pushRes
        } else {
            stack.push(Integer.parseInt(c));                  @push
        }
    }
    return stack.peek();                                      @done
}
`,
    cpp: `
int evalRPN(vector<string>& tokens) {
    vector<int> stack;                                        @init
    for (string& c : tokens) {                                @loop
        if (c == "+" || c == "-" || c == "*" || c == "/") {   @isOp
            int b = stack.back(); stack.pop_back();           @popTwo
            int a = stack.back(); stack.pop_back();
            int res;
            if (c == "+") res = a + b;                        @add
            else if (c == "-") res = a - b;                   @sub
            else if (c == "*") res = a * b;                   @mul
            else res = a / b;                                 @div
            stack.push_back(res);                             @pushRes
        } else {
            stack.push_back(stoi(c));                         @push
        }
    }
    return stack[0];                                          @done
}
`,
    distractors: [
      { java: '            int a = stack.pop(), b = stack.pop();', cpp: '            int a = stack.back(); stack.pop_back();\n            int b = stack.back(); stack.pop_back();' },
      { java: '            else res = Math.floorDiv(a, b);', cpp: '            else res = (int)floor((double)a / b);' },
      { java: '            stack.push(c);', cpp: '            stack.push_back(c);' },
    ],
    gotchas: {
      python: ['`a // b` floors toward −∞ (−7 // 2 = −4); truncation toward zero needs `int(a / b)`.'],
      java: [
        'Java `/` on ints already truncates toward zero, exactly what RPN wants — `Math.floorDiv` would be the bug here.',
        'Compare strings with `c.equals("+")`, never `c == "+"` (reference comparison).',
      ],
      cpp: ['C++ `/` on ints truncates toward zero (guaranteed since C++11), so `a / b` is already correct; `stoi` parses negative tokens like `"-11"`.'],
    },
  },

  'generate-parentheses': {
    java: `
private StringBuilder stack;
private List<String> res;
private int n;
public List<String> generateParenthesis(int n) {
    stack = new StringBuilder(); res = new ArrayList<>();     @init
    this.n = n;
    backtrack(0, 0);                                          @start
    return res;                                               @done
}
private void backtrack(int openN, int closedN) {
    if (openN == n && closedN == n) {                         @base
        res.add(stack.toString());                            @record
        return;
    }
    if (openN < n) {                                          @canOpen
        stack.append('(');                                    @pushOpen
        backtrack(openN + 1, closedN);                        @recOpen
        stack.deleteCharAt(stack.length() - 1);               @popOpen
    }
    if (closedN < openN) {                                    @canClose
        stack.append(')');                                    @pushClose
        backtrack(openN, closedN + 1);                        @recClose
        stack.deleteCharAt(stack.length() - 1);               @popClose
    }
}
`,
    cpp: `
vector<string> generateParenthesis(int n) {
    string stack; vector<string> res;                         @init
    function<void(int, int)> backtrack = [&](int openN, int closedN) {
        if (openN == n && closedN == n) {                     @base
            res.push_back(stack);                             @record
            return;
        }
        if (openN < n) {                                      @canOpen
            stack.push_back('(');                             @pushOpen
            backtrack(openN + 1, closedN);                    @recOpen
            stack.pop_back();                                 @popOpen
        }
        if (closedN < openN) {                                @canClose
            stack.push_back(')');                             @pushClose
            backtrack(openN, closedN + 1);                    @recClose
            stack.pop_back();                                 @popClose
        }
    };
    backtrack(0, 0);                                          @start
    return res;                                               @done
}
`,
    distractors: [
      { java: '    if (closedN < n) {', cpp: '        if (closedN < n) {' },
      { java: '        backtrack(openN + 1, closedN + 1);', cpp: '            backtrack(openN + 1, closedN + 1);' },
      { java: '    if (openN + closedN == n) {', cpp: '        if (openN + closedN == n) {' },
    ],
    gotchas: {
      java: ['Strings are immutable — `stack + "("` copies on every call; a shared `StringBuilder` with `deleteCharAt(length() - 1)` gives O(1) push/undo.'],
      cpp: [
        '`openN == closedN == n` compiles in C++ but means `(openN == closedN) == n` (a bool compared to n) — spell out `openN == n && closedN == n`.',
        'A recursive lambda must be a `function<>` captured by reference (`[&]`) — `auto` lambdas cannot name themselves.',
      ],
    },
  },

  'daily-temperatures': {
    java: `
public int[] dailyTemperatures(int[] temperatures) {
    int[] res = new int[temperatures.length];                 @init
    Deque<int[]> stack = new ArrayDeque<>();  // [temp, index], decreasing   @initStack
    for (int i = 0; i < temperatures.length; i++) {           @loop
        int t = temperatures[i];
        while (!stack.isEmpty() && t > stack.peek()[0]) {     @while
            int[] top = stack.pop();                          @pop
            int stackT = top[0], stackInd = top[1];
            res[stackInd] = i - stackInd;                     @answer
        }
        stack.push(new int[] { t, i });                       @push
    }
    return res;                                               @done
}
`,
    cpp: `
vector<int> dailyTemperatures(vector<int>& temperatures) {
    vector<int> res(temperatures.size(), 0);                  @init
    vector<pair<int, int>> stack;  // [temp, index], decreasing   @initStack
    for (int i = 0; i < (int)temperatures.size(); i++) {      @loop
        int t = temperatures[i];
        while (!stack.empty() && t > stack.back().first) {    @while
            auto [stackT, stackInd] = stack.back(); stack.pop_back();   @pop
            res[stackInd] = i - stackInd;                     @answer
        }
        stack.push_back({t, i});                              @push
    }
    return res;                                               @done
}
`,
    distractors: [
      { java: '        if (!stack.isEmpty() && t > stack.peek()[0]) {', cpp: '        if (!stack.empty() && t > stack.back().first) {' },
      { java: '        while (!stack.isEmpty() && t >= stack.peek()[0]) {', cpp: '        while (!stack.empty() && t >= stack.back().first) {' },
      { java: '            res[stackInd] = t - stackT;', cpp: '            res[stackInd] = t - stackT;' },
    ],
    gotchas: {
      java: ['A stack of `int[]` pairs avoids boxing; storing only the index (`Deque<Integer>`) and reading `temperatures[stack.peek()]` is the leaner variant.'],
      cpp: ['Bind with `auto [stackT, stackInd] = stack.back()` (a copy) before `pop_back()` — `auto&` would dangle once the element is popped.'],
    },
  },

  'car-fleet': {
    java: `
public int carFleet(int target, int[] position, int[] speed) {
    int n = position.length;
    int[][] pair = new int[n][];
    for (int i = 0; i < n; i++) pair[i] = new int[] { position[i], speed[i] };
    Arrays.sort(pair, (x, y) -> Integer.compare(y[0], x[0]));          @sort
    List<Double> stack = new ArrayList<>();  // arrival times of fleet leaders   @init
    for (int[] ps : pair) {                                            @loop
        int p = ps[0], s = ps[1];
        stack.add((double) (target - p) / s);                          @push
        if (stack.size() >= 2 && stack.get(stack.size() - 1) <= stack.get(stack.size() - 2)) {   @check
            stack.remove(stack.size() - 1);                            @merge
        }
    }
    return stack.size();                                               @done
}
`,
    cpp: `
int carFleet(int target, vector<int>& position, vector<int>& speed) {
    vector<pair<int, int>> pair;
    for (int i = 0; i < (int)position.size(); i++) pair.push_back({position[i], speed[i]});
    sort(pair.rbegin(), pair.rend());                                  @sort
    vector<double> stack;  // arrival times of fleet leaders           @init
    for (auto& [p, s] : pair) {                                        @loop
        stack.push_back((double)(target - p) / s);                     @push
        if ((int)stack.size() >= 2 && stack.back() <= stack[stack.size() - 2]) {   @check
            stack.pop_back();                                          @merge
        }
    }
    return (int)stack.size();                                          @done
}
`,
    distractors: [
      { java: '    Arrays.sort(pair, (x, y) -> Integer.compare(x[0], y[0]));', cpp: '    sort(pair.begin(), pair.end());' },
      {
        java: '        if (stack.size() >= 2 && stack.get(stack.size() - 1) < stack.get(stack.size() - 2)) {',
        cpp: '        if ((int)stack.size() >= 2 && stack.back() < stack[stack.size() - 2]) {',
      },
      { java: '        stack.add((double) s / (target - p));', cpp: '        stack.push_back((double)s / (target - p));' },
    ],
    gotchas: {
      java: [
        '`(target - p) / s` is INTEGER division in Java — cast first: `(double) (target - p) / s`.',
        'An `ArrayList` is used because the check needs the top TWO entries; `Deque` has no indexed access.',
      ],
      cpp: ['`(target - p) / s` on ints truncates — cast to `double` first; `sort(rbegin(), rend())` sorts descending.'],
    },
  },

  'largest-rectangle-in-histogram': {
    java: `
public int largestRectangleArea(int[] heights) {
    int maxArea = 0;                                              @init
    Deque<int[]> stack = new ArrayDeque<>();  // (start index, height), increasing   @initStack
    for (int i = 0; i < heights.length; i++) {                    @loop
        int h = heights[i];
        int start = i;                                            @start
        while (!stack.isEmpty() && stack.peek()[1] > h) {         @while
            int[] top = stack.pop();                              @pop
            int index = top[0], height = top[1];
            maxArea = Math.max(maxArea, height * (i - index));    @area
            start = index;                                        @extend
        }
        stack.push(new int[] { start, h });                       @push
    }
    for (int[] e : stack) {                                       @tail
        int i = e[0], h = e[1];
        maxArea = Math.max(maxArea, h * (heights.length - i));    @tailArea
    }
    return maxArea;                                               @done
}
`,
    cpp: `
int largestRectangleArea(vector<int>& heights) {
    int maxArea = 0;                                              @init
    vector<pair<int, int>> stack;  // (start index, height), increasing   @initStack
    for (int i = 0; i < (int)heights.size(); i++) {               @loop
        int h = heights[i];
        int start = i;                                            @start
        while (!stack.empty() && stack.back().second > h) {       @while
            auto [index, height] = stack.back(); stack.pop_back();   @pop
            maxArea = max(maxArea, height * (i - index));         @area
            start = index;                                        @extend
        }
        stack.push_back({start, h});                              @push
    }
    for (auto& [i, h] : stack) {                                  @tail
        maxArea = max(maxArea, h * ((int)heights.size() - i));    @tailArea
    }
    return maxArea;                                               @done
}
`,
    distractors: [
      { java: '            maxArea = Math.max(maxArea, height * (i - index + 1));', cpp: '            maxArea = max(maxArea, height * (i - index + 1));' },
      { java: '        stack.push(new int[] { i, h });', cpp: '        stack.push_back({i, h});' },
      { java: '        while (!stack.isEmpty() && stack.peek()[1] < h) {', cpp: '        while (!stack.empty() && stack.back().second < h) {' },
    ],
    gotchas: {
      java: ['Iterating an `ArrayDeque` with for-each goes top → bottom (push adds at the front) — harmless for a max, but surprising if order matters.'],
      cpp: [
        '`height * ((int)heights.size() - i)` — without the `(int)` cast, `size()` is unsigned and the subtraction is done in `size_t`.',
        'Areas reach 10⁵ × 10⁴ = 10⁹, which still fits in `int`; larger limits would need `long long`.',
      ],
    },
  },
};
