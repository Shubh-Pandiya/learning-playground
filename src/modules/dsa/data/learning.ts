export interface Principle {
  name: string;
  /** what the research says, in one or two sentences */
  finding: string;
  /** where the playground applies it */
  where: string;
  /** what the learner should do */
  tip: string;
}

export const principles: Principle[] = [
  {
    name: 'Patterns over problems (schema building)',
    finding:
      'Experts don’t remember more solutions; they hold fewer, richer schemas and classify problems by deep structure, while novices sort by surface features (Chi, Feltovich & Glaser 1981).',
    where: 'Everything is organised around ~27 patterns. Each pattern page has the mental model, signals, template, invariants and mistakes, and each problem links back to its pattern.',
    tip: 'After each problem, open its pattern page and ask yourself what was the same as the template and what was different.',
  },
  {
    name: 'Retrieval practice (testing effect)',
    finding: 'Pulling information out of memory strengthens it far more than re-reading it (Roediger & Karpicke 2006).',
    where: 'The recognition gate before each problem, the drill, the hidden key insight, review mode (“write from memory, then reveal”) and the from-scratch builder.',
    tip: 'Always attempt before you reveal, even if you are sure you will be wrong.',
  },
  {
    name: 'Generation & prediction',
    finding: 'Predicting an outcome before seeing it, even wrongly, improves later recall and makes the correct answer more salient (Slamecka & Graf 1978; Kornell et al. 2009).',
    where: 'Predict-before-reveal questions inside every trace (the visualization blurs until you answer), plus the optional “which line runs next?” quiz at every branch.',
    tip: 'Keep predict mode on. Treat wrong predictions as the most valuable moments.',
  },
  {
    name: 'Worked examples → faded scaffolding → independent practice',
    finding:
      'Beginners learn most from studying worked examples, but the benefit reverses as expertise grows (expertise-reversal effect). Gradually removing steps works best (Sweller; Renkl & Atkinson 2003).',
    where: 'The Build tab has three levels: a worked example with a reason per line, fill-the-gaps with locked lines, and build-from-scratch with trap blocks. The suggested level moves up as you succeed.',
    tip: 'Don’t skip straight to scratch on a new pattern, and don’t stay on worked examples once they feel easy.',
  },
  {
    name: 'Immediate, targeted feedback',
    finding: 'Feedback that says why something is wrong beats a bare right/wrong signal, especially right after the attempt (Hattie & Timperley 2007).',
    where: 'Every trap block in the builder carries an explanation of the bug it would cause. Misplaced lines are marked and come with a hint about the line that belongs there, and predictions explain the real outcome.',
    tip: 'Read the “why” on every trap. Those are the exact bugs interviewers watch for.',
  },
  {
    name: 'Interleaving',
    finding: 'Mixing problem types forces you to choose a strategy, which is what tests and interviews require. Blocked practice feels easier but transfers worse (Rohrer & Taylor 2007).',
    where: 'The drill never shows the same pattern twice in a row and puts confusable patterns side by side as options. Even a focused drill mixes in about 40% other patterns.',
    tip: 'Run a mixed drill every session, even while you are working through one category.',
  },
  {
    name: 'Spaced repetition',
    finding: 'Reviews spaced at expanding intervals produce much more durable memory than massed practice (Ebbinghaus; Cepeda et al. 2006).',
    where: 'Successful builds enter an SM-2-style queue. You rate your recall Again/Hard/Good/Easy, and the review page schedules each problem just before you would forget it.',
    tip: 'Clear the review queue first in each session. It takes minutes and has the highest payoff.',
  },
  {
    name: 'Self-explanation',
    finding: 'Learners who explain to themselves why each step works understand more deeply and transfer better (Chi et al. 1989).',
    where: 'The Reflect tab and pattern pages ask targeted “why” questions, notes are saved, and the worked-example level asks you to explain every line.',
    tip: 'Write as if teaching a teammate. If you can’t explain the invariant, you don’t own the pattern yet.',
  },
  {
    name: 'Dual coding & managing cognitive load',
    finding: 'Combining words with visuals helps, provided the visuals don’t split attention or overload working memory (Paivio; Mayer; Sweller).',
    where: 'Code, narration, watch panel and visualization move in lock-step, one change per step. Pointers keep fixed colours (left = blue, right = violet, mid = orange) and changed variables flash. Loop counters show which iteration you are in.',
    tip: 'Step slowly through the first run. Speed up only once you can say what the next step will be.',
  },
  {
    name: 'Elaboration via real-world anchors',
    finding: 'Connecting new knowledge to what you already know creates more retrieval paths (elaborative encoding).',
    where: 'Every problem and pattern names a concrete backend use: top-K IPs for rate limiting, sliding-window rate limiters, topo-sort for build or migration order, union-find for account merging, tries for autocomplete and routing.',
    tip: 'Use the “connect it to your work” box. A personal example sticks better than any of ours.',
  },
  {
    name: 'Far transfer with varied practice',
    finding: 'Transfer improves when you meet the same deep structure in different surface stories and compare them (Gick & Holyoak 1983).',
    where: 'New-problem mode offers unseen variants, each re-dressing a NeetCode pattern in a new (often backend) story. You name the pattern, write a plan, then compare against the reference and the closest NeetCode problem.',
    tip: 'When you get a variant wrong, open the nearest problem and say aloud what maps to what.',
  },
  {
    name: 'Desirable difficulty & progressive hints',
    finding: 'Struggle that is effortful but achievable produces better long-term learning. Hints should reveal as little as possible (Bjork 1994).',
    where: 'Hints come one at a time, from least to most revealing. The insight is hidden behind a button, and hint usage is tracked so you can see your own dependence.',
    tip: 'Wait 2 minutes stuck before taking a hint, and take only one at a time.',
  },
  {
    name: 'Motivation: progress, streaks and small wins',
    finding: 'Visible progress and short, completable sessions sustain practice (the progress principle; goal-gradient effect).',
    where: 'The dashboard has mastery levels per problem, progress per category and pattern, a daily streak and a ~30-minute session plan. Progress is saved locally.',
    tip: 'Aim for a daily 30-minute session over occasional long ones.',
  },
  {
    name: 'Practise in your interview language (transfer-appropriate processing)',
    finding:
      'Memory works best when the conditions at practice match the conditions at test (Morris, Bransford & Franks 1977). Translating from an unfamiliar language while also learning a pattern adds extraneous cognitive load (Sweller).',
    where:
      'Pick Python, Java or C++ once. Templates, solutions, the step-through code panel and every drag-and-drop block then use that language, and the watch panel prints null/None and true/True the way your language does. Language-specific gotchas are shown next to each pattern and problem.',
    tip: 'Use the language you will write in the interview, and read the gotchas. Those are exactly the bugs that cost time on a whiteboard.',
  },
];
