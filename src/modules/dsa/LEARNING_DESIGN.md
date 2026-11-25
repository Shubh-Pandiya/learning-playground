# DSA Patterns Playground: learning design

The goal is not to memorise 150 solutions. It is to recognise and adapt about 27 **patterns** under interview pressure, including on problems you have never seen. Each mechanic below rests on a learning-science finding. The in-app page `/dsa/method` (data in `data/learning.ts`) shows the same material to the learner.

## The per-problem loop

`pages/Playground.tsx` runs every problem through five steps:

1. **Recognise.** `RecognitionGate` asks you to pick the pattern from the statement before any help appears. This is retrieval practice, and it trains classification by deep structure.
2. **Watch & predict.** `components/Visualizer.tsx` steps through a real execution of the solution on input you can edit. The engine (`engine/tracer.ts`) runs a JS port of the Python code and records frames.
3. **Rebuild.** `components/Builder.tsx` has three levels: worked example, faded, and from scratch with trap blocks.
4. **Explain.** The Reflect tab asks for a self-explanation, a backend connection of your own, and a recall grade.
5. **Space it.** The grade feeds an SM-2 card through the shared `review()` helper, and `pages/Review.tsx` brings the problem back when it falls due.

## Principles and where they live

| Principle | Research | Where in the code |
|---|---|---|
| Schema building / patterns over problems | Chi, Feltovich & Glaser 1981 (experts sort by deep structure) | `data/patterns.ts` (intuition, signals, template, invariants, mistakes, backend uses), `pages/Patterns.tsx`, each problem's `pattern` and `signals` |
| Retrieval practice (testing effect) | Roediger & Karpicke 2006 | Recognition gate, `pages/Drill.tsx`, hidden "key insight" in Understand, recall-first `pages/Review.tsx`, scratch builder |
| Generation / prediction | Slamecka & Graf 1978; Kornell et al. 2009 | `predict` questions in traces (the viz blurs until you answer, and you can't step past an unanswered one); the auto line quiz "which line runs next?" at branches and loops |
| Worked → faded → independent (expertise reversal) | Sweller; Renkl & Atkinson 2003 | `Builder.tsx` levels `worked` / `faded` / `scratch`; the suggested level advances in `store.ts` (`built.*`) |
| Immediate targeted feedback | Hattie & Timperley 2007 | Each trap block has a `why` explaining the bug it causes. Misplaced lines show the explanation of the line that belongs there. Predictions explain the real outcome |
| Interleaving | Rohrer & Taylor 2007 | The drill never repeats a pattern back to back and offers confusable patterns as options. Even a focused drill is 60/40 mixed |
| Spaced repetition | Ebbinghaus; Cepeda et al. 2006 | `store.ts` creates a card on the first faded or scratch build and `grade()` uses the shared SM-2. `pages/Review.tsx` serves the queue, and the nav and home card show the due count |
| Self-explanation | Chi et al. 1989 | The Reflect note, per-pattern notes, and "I can explain every line" on worked examples |
| Dual coding & cognitive load | Paivio; Mayer; Sweller | Code, narration, watch panel and viz move in lock-step with one change per frame. Pointer colours are fixed (`viz/tones.ts`), changed variables flash, and `↻ n` loop counters label loop iterations. A frame cap keeps runs short |
| Elaboration via real-world anchors | Elaborative encoding | Every problem has a `backend` use case (e.g. Top K Frequent → hottest client IPs for rate limiting), every pattern lists backend uses, and you add your own in "connect it to your work" |
| Far transfer via varied practice | Gick & Holyoak 1983 | Over 40 unseen `variants` re-dress patterns in new (mostly backend) stories. `pages/Transfer.tsx` asks you to name the pattern, write a plan, then compare with the reference and the nearest NeetCode problem |
| Desirable difficulty & minimal hints | Bjork 1994 | Hints are progressive and their use is tracked. Pattern labels can be hidden in the problem list so they don't give the answer away |
| Transfer-appropriate processing / reduced extraneous load | Morris, Bransford & Franks 1977; Sweller | Language choice (Python / Java / C++, `lang/store.ts` → `lp:dsa:lang`, first-visit picker in `components/LangSwitch.tsx`). All code surfaces render in that language: `lang/code.ts` with translations in `problems/lang/*.ts` and `data/pattern-langs.ts`, which share `@key` line markers so traces, explanations and builder checks stay aligned. Language gotchas sit next to each pattern and problem |
| Motivation: visible progress & small wins | Progress principle; goal-gradient effect | Dashboard mastery levels, per-category progress, streak, a ~30-minute "today's session" plan, and the home-page card via `useReportProgress` |

## Mastery levels (`store.ts → mastery`)

0 new · 1 explored (visualized or recognised) · 2 practised (worked build) · 3 built (faded or scratch) · 4 mastered (scratch build plus at least 3 successful spaced reviews).

## Persistence

All progress lives in `localStorage` at `lp:dsa:progress` (the chosen code language is stored at `lp:dsa:lang`) (zustand persist via `createPersistedStore('dsa', 'progress', …)`). It can be exported or reset from the app's Settings page.
