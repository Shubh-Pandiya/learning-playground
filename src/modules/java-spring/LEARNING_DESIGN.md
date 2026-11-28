# Java and Spring Boot: mechanism -> retrieval -> transfer

## Audience and scope

SDE-2 engineers preparing for senior backend interviews. Fourteen concentrated
concept clusters prioritize production failure mechanisms: JVM/GC, memory model,
locks, executors, collections, language contracts, IoC, Boot wiring, proxies,
transactions, MVC/WebFlux, JPA and security/observability. Java 21 is the baseline;
collector and virtual-thread changes in newer JDKs are explicitly labeled. Spring
examples assume ordinary proxy-based imperative transactions unless stated.

The module is not a Java compiler, JVM emulator, full Spring runtime, exhaustive
language course or interview-readiness certification. It contains no code-writing
exercises. Snippets are erroneous examples to read and diagnose.

## Evidence and design decisions

The strongest basis is **retrieval practice and distributed practice**, not
personalized "visual learning styles." The Learning Scientists' research synthesis
explicitly distinguishes the strength of evidence for spacing/retrieval from more
conditional supporting techniques:

- [Six strategies, with research references](https://www.learningscientists.org/blog/2016/8/18-1)
  (Smith/Sumeracki and Weinstein, 2016): spacing, retrieval, elaboration,
  interleaving, concrete examples and dual coding.
- [Retrieval practice](https://www.learningscientists.org/blog/2016/6/23-1):
  attempt recall before checking; retrieve connections and applications, not only
  vocabulary. Delayed retrieval matters, not immediate recitation of visible text.
- [Carnegie Mellon research-based learning principles](https://www.cmu.edu/teaching/principles/learning.html):
  activate prior knowledge, organize causal knowledge, integrate component skills
  and pair targeted practice with useful feedback.

These accessible research syntheses were read during implementation. We do not
claim a direct experiment establishes this particular Java/Spring interface as
"the best" or validates a specific 20-minute session length.

| Mechanism | Implementation | Boundary of the evidence |
| --- | --- | --- |
| Spaced retrieval | Shared SM-2-style scheduler, persisted per prediction/explanation/incident | Spacing is well supported; exact heuristic intervals are not a proven optimum |
| Retrieval before feedback | Mandatory answer/attempt and confidence before reveal | Multiple choice is recognition-heavy; free explanation complements it |
| Causal organization and dual coding | Labeled, animated state traces with explicit assumptions | Visuals support explanations, not a learning-style diagnosis; watching is not mastery |
| Prediction | Every mechanism is gated behind a committed prediction and feedback | A practical active-processing device, not independently claimed superior in all contexts |
| Interleaving | Review alternates Java/Spring topics and rotates question types | Helps contrast similar mechanisms; effect depends on task and prior knowledge |
| Reconstruction | Drag/keyboard/button ordering of bean, transaction, MVC and security flows | Use ordering only where there is a meaningful temporal dependency |
| Erroneous examples and transfer | Read-only code bugs, thread dumps, SQL counts, pool waits and health incidents | Intended to practice diagnosis; not a substitute for actual production experience |
| Metacognitive calibration | Confidence before answer; confident misses tracked separately | Free-response grading is honest self-assessment, not AI/objective evaluation |

## Learning loop

A practical short session: 5 minutes due review, 8 minutes one mechanism, 5 minutes
incident/assembly and 2 minutes spoken causal explanation. Timing is a convenient
habit, not an experimentally optimized dose.

1. Commit a prediction and confidence before the visualization is available.
2. Compare feedback, rate recall, then step/play/pause the mechanism.
3. State the invariant and why the next state follows. Visuals are deliberately
   small explanatory models, with assumptions and version caveats.
      Atomic increment, cross-bean proxy calls and REQUIRES_NEW have switchable
      counterfactuals: change one boundary, commit a new prediction, and compare the
      resulting trace. They use separate review card identities.
4. Reconstruct ordering where applicable. Pointer, keyboard and move buttons are
   supported; wrong ordering identifies the first incorrect boundary.
5. Explain a senior question aloud or in text before revealing a model answer.
   Rate recall honestly against mechanism, failure mode and tradeoff.
6. Diagnose an incident from evidence, including why distractors fail.
7. Return for delayed mixed retrieval. Missed answers cannot receive a successful
   multiple-choice grade; an initial miss schedules Forgot.

A concept becomes **practiced** after completing the mechanism, solving its
incident, solving its ordering task when present and successfully rating a senior
explanation. This is completion, not proof of mastery. The home summary reports
completed concept practice and due items without loading the module bundle.

## Technical fidelity and constraints

Each topic links its runtime/framework source. Key references verified directly:
[JLS happens-before](https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html),
[JEP 444](https://openjdk.org/jeps/444),
[Spring transactional annotation/proxy semantics](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html),
and [transaction propagation](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html).
Other topic links are reference reading, not a claim that every linked document
was fully fetched during research.

Important counterexamples are explicit: volatile is not atomic increment;
reachable leaks survive GC; self-invocation skips inner advice but may still run
inside an existing outer transaction; flush is not commit; REQUIRES_NEW consumes
additional resources; wrapping a blocking call in Mono does not make it
nonblocking; singleton does not mean thread-safe.

State uses `lp:java:progress`; review cards, confidence, studied/solved/ordered
flags and resume topic are serializable and work with shared export/import/reset.
Shared controls and theme tokens are reused. Motion respects reduced-motion
preferences. Review queues snapshot at session start to prevent ratings from
shuffling a card out from under the learner.

No telemetry, external AI calls, paid services or runtime research requests are
needed. This keeps both learning and ongoing AI-credit usage inexpensive.
