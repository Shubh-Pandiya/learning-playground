export interface Question {
  prompt: string;
  options: string[];
  answer: number;
  why: string;
}

export interface Frame {
  title: string;
  explain: string;
  lanes: { label: string; value: string; active?: boolean }[];
}

export interface Topic {
  id: string;
  domain: 'Java' | 'Spring';
  title: string;
  tagline: string;
  theory: string[];
  frames: Frame[];
  prediction: Question;
  recall: { prompt: string; answer: string };
  drill: Question & { title: string; code?: string; evidence: string };
  order?: { prompt: string; items: string[]; why: string };
  source: string;
}

const frame = (title: string, explain: string, lanes: [string, string, boolean?][]): Frame => ({
  title, explain, lanes: lanes.map(([label, value, active]) => ({ label, value, active })),
});

export const TOPICS: Topic[] = [
  {
    id: 'jvm', domain: 'Java', title: 'JVM: from class file to native code',
    tagline: 'Separate loading, linking, initialization, execution and memory ownership.',
    theory: [
      'Parent-first delegation is the usual class-loader model, not a universal rule. Class identity includes both binary name and defining loader.',
      'Linking verifies, prepares static storage with default values, and resolves symbolic references (resolution may be lazy). Initialization runs static initializers on active use.',
      'Each thread has stack frames with local variables and operand stacks. Objects conceptually live in the shared heap; HotSpot stores class metadata in native metaspace. A reference on the stack is not the object.',
      'HotSpot commonly interprets then tier-compiles hot code. Profiling guides inlining and speculative optimization; invalid assumptions can trigger deoptimization. Escape analysis may eliminate allocations rather than move every object onto the stack.',
    ],
    frames: [
      frame('Load', 'A defining loader creates the runtime representation of a class. Loading alone need not execute its static initializer.', [['Class file', 'Order.class', true], ['Metaspace', 'Class metadata created'], ['Heap', 'No Order instance yet']]),
      frame('Link', 'Verification checks bytecode; preparation sets static defaults. Resolution may be deferred.', [['Verifier', 'Bytecode constraints checked', true], ['Static int count', '0, before initializer'], ['Thread stack', 'Not an object store']]),
      frame('Initialize and allocate', 'Active use initializes the class. new creates an instance; a method frame can retain its reference.', [['Initializer', 'count = 10', true], ['Heap', 'Order #42'], ['Thread stack', 'local reference -> Order #42']]),
      frame('Optimize hot execution', 'The JIT uses profiling to compile hot code. Heap size does not cap native metadata or every other native allocation.', [['JIT', 'Profile -> compiled native code', true], ['Code cache', 'Compiled methods'], ['Metaspace', 'Loader-owned metadata']]),
    ],
    prediction: { prompt: 'A service keeps creating class loaders and retaining them. Which memory area can grow even with a stable Java heap?', options: ['Only each method stack', 'Metaspace', 'The String pool alone'], answer: 1, why: 'Retained defining loaders keep class metadata alive. Investigate native memory and loader retention, not only -Xmx.' },
    recall: { prompt: 'Why can two classes named com.acme.Order fail a cast, and what separates linking from initialization?', answer: 'Class identity is (binary name, defining loader). Different defining loaders produce distinct types. Linking verifies/prepares/resolves; initialization executes static initializers on active use. Senior signal: correlate loader counts, native memory and deployment/reload behavior before blaming heap GC.' },
    drill: { title: 'Stable heap, rising RSS', evidence: 'After each plugin reload: heap returns to baseline, loaded class count grows, RSS rises; old loaders are retained by a static registry.', prompt: 'What is the first corrective investigation?', options: ['Double -Xmx', 'Remove registry retention and verify class unloading/native memory', 'Run System.gc() on every request'], answer: 1, why: 'GC cannot unload classes while their defining loaders are strongly reachable. Fix ownership and inspect class-loader/native-memory evidence.' },
    source: 'https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-5.html',
  },
  {
    id: 'gc', domain: 'Java', title: 'GC: reachability, generations and latency',
    tagline: 'A collector cannot reclaim an object your application still owns.',
    theory: [
      'Tracing starts from GC roots: live threads, static references and other runtime roots. Reachability, not whether you intend to use an object again, controls reclamation.',
      'Generational collection exploits short-lived objects. A simplified young collection evacuates survivors and may promote them; actual ages, regions and allocation paths depend on collector and configuration.',
      'G1 uses regions, young evacuation and mixed collections of young plus selected old regions. Concurrent marking does not mean every phase is pause-free; large humongous objects can pressure old regions.',
      'ZGC targets low pauses with concurrent work, trading CPU/headroom for latency. Generational ZGC arrived in JDK 21, became default ZGC mode in 23; non-generational ZGC was removed in 24. Choose using allocation rate, live set, pause SLOs, CPU and version, not slogans.',
    ],
    frames: [
      frame('Allocate a request graph', 'Objects A and B are reachable from a request. C has no root path.', [['GC root', 'request -> A -> B', true], ['Young regions', 'A, B, C'], ['Old regions', 'long-lived cache']]),
      frame('Trace live objects', 'C is garbage. A and B survive because there is a root path.', [['Root graph', 'A -> B marked live', true], ['Unreachable', 'C eligible for reclamation'], ['Static cache', 'Still a GC root path']]),
      frame('Evacuate survivors', 'A simplified generational collection copies live young objects and reclaims the collected space.', [['Survivor space', 'A -> B', true], ['Reclaimed', 'C and unused space'], ['Promotion', 'Older survivors may move to old regions']]),
      frame('Observe the retained live set', 'If a cache retains B forever, no collector can solve the application leak. Repeated post-GC live-set growth is evidence.', [['Old regions', 'cache -> B retained', true], ['G1', 'Mark + selected mixed evacuation'], ['ZGC', 'Concurrent relocation; CPU/headroom tradeoff']]),
    ],
    prediction: { prompt: 'An unbounded static map retains every request payload. Will moving from G1 to ZGC remove the leak?', options: ['Yes, concurrent relocation removes references', 'No, reachable objects remain live', 'Yes, if pauses are below 1 ms'], answer: 1, why: 'Both collectors preserve reachable objects. Bound the cache and fix retention; validate post-GC live-set trends.' },
    recall: { prompt: 'What evidence distinguishes allocation pressure from a memory leak, and when would you evaluate ZGC?', answer: 'High allocation with a stable post-GC live set suggests churn; a growing post-GC live set suggests retention. Inspect GC logs/JFR and heap dominators. Evaluate ZGC against a measured tail-latency SLO with sufficient CPU and heap headroom, on the actual JDK version. Neither collector guarantees zero pauses or fixes live-object leaks.' },
    drill: { title: 'The cache that never forgets', evidence: 'p99 pauses rise. Full-GC live heap grows 200 MB -> 500 MB -> 900 MB. A heap dominator is a static Map<String, byte[]> keyed by request ID.', prompt: 'Which intervention addresses the root cause?', options: ['Set a bounded retention/eviction policy and verify the live set stabilizes', 'Raise the pause target indefinitely', 'Disable all logging'], answer: 0, why: 'The map retains a growing graph. Heap expansion delays exhaustion; bounded ownership addresses the leak. GC logs and heap analysis confirm the fix.' },
    source: 'https://docs.oracle.com/en/java/javase/21/gctuning/introduction-garbage-collection-tuning.html',
  },
  {
    id: 'jmm', domain: 'Java', title: 'JMM: visibility is not atomicity',
    tagline: 'Predict a lost update, then establish the happens-before edge.',
    theory: [
      'The Java Memory Model defines legal observations across threads, not a literal cache-flushing recipe. Data races mean no suitable happens-before ordering.',
      'A volatile write happens-before subsequent reads of that variable. Unlock happens-before a subsequent lock of the same monitor; start and successful join also provide ordering edges.',
      'volatile count++ is a read-modify-write sequence, not an atomic increment. synchronized or an atomic operation can protect it; invariants involving multiple variables often require a lock.',
      'CAS retries compare-and-update operations; contention and ABA may matter. AtomicInteger supports linearizable increments, while LongAdder favors contended statistics and does not provide an atomic snapshot sum.',
    ],
    frames: [
      frame('Both threads read', 'count is volatile and initially 0. Each read sees 0; volatile does not make the whole expression indivisible.', [['Thread A', 'read count = 0', true], ['Shared count', '0'], ['Thread B', 'read count = 0', true]]),
      frame('A computes and writes', 'A computes 0 + 1 and writes 1.', [['Thread A', 'write count = 1', true], ['Shared count', '1'], ['Thread B', 'local previous value = 0']]),
      frame('B writes stale computation', 'B writes its computed 1. This interleaving is legal even though the individual reads/writes are visible.', [['Thread A', 'finished'], ['Shared count', '1, not 2', true], ['Thread B', 'write count = 1', true]]),
      frame('Make the operation atomic', 'With AtomicInteger.incrementAndGet, each increment is one atomic operation. A failed CAS can retry with the new value.', [['Thread A', 'atomic 0 -> 1'], ['Shared count', '2', true], ['Thread B', 'atomic 1 -> 2']]),
    ],
    prediction: { prompt: 'Two threads each execute volatile count++ once, starting at 0. Is a final value of 1 legal?', options: ['No, volatile locks both threads', 'Yes, read-modify-write is not atomic', 'Only if count is not volatile'], answer: 1, why: 'Both can read 0 then both write 1. Visibility is separate from atomicity.' },
    recall: { prompt: 'Explain safe publication through a volatile flag and its limit.', answer: 'Writer: data = 42; ready = true (volatile). Reader observing ready == true then reading data gets the preceding write through program order + volatile synchronization + transitivity. This does not make later unsynchronized mutations safe, nor make compound operations atomic. Prefer immutable published objects or explicit synchronization for continuing mutation.' },
    drill: { title: 'The accurate-looking counter', code: 'volatile int completed;\nvoid finish() { completed++; }', evidence: 'No exceptions. Under load the completion count is smaller than the number of successful tasks.', prompt: 'Which fix matches an exact shared counter?', options: ['Add Thread.sleep(1)', 'Use AtomicInteger.incrementAndGet()', 'Make the field public'], answer: 1, why: 'Atomic increment prevents lost updates. Sleeping is not a synchronization edge. For a multi-field invariant, lock the complete transition instead.' },
    source: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-17.html#jls-17.4.5',
  },
  {
    id: 'locks', domain: 'Java', title: 'Locks, deadlocks and coordination',
    tagline: 'Reason about ownership, ordering and cancellation rather than adding locks blindly.',
    theory: [
      'synchronized is reentrant, provides mutual exclusion and visibility, and releases the monitor on scope exit including exceptional exit.',
      'ReentrantLock offers interruptible/timed acquisition and multiple Conditions; unlock in finally. A fair lock may reduce starvation at a throughput cost and does not guarantee OS scheduling fairness.',
      'Deadlock requires a cycle of ownership/waits. Establish a consistent global lock ordering; timed acquisition and cancellation can bound waiting but need rollback/cleanup.',
      'ConcurrentHashMap protects its operations, not arbitrary get-then-put business logic. compute/merge can make per-key changes atomic; do not put blocking external calls in mapping functions. BlockingQueue, Semaphore and CountDownLatch express coordination at higher levels.',
    ],
    frames: [
      frame('A owns account X', 'A begins X -> Y transfer; B begins Y -> X.', [['Thread A', 'owns X', true], ['Locks', 'X -> A; Y free'], ['Thread B', 'not yet locked']]),
      frame('B owns account Y', 'Each owns one lock and needs the other.', [['Thread A', 'owns X; needs Y'], ['Locks', 'X -> A; Y -> B', true], ['Thread B', 'owns Y; needs X']]),
      frame('Wait cycle', 'Neither thread can release its first lock because both block acquiring their second.', [['Thread A', 'waits for B -> Y', true], ['Cycle', 'A -> B -> A', true], ['Thread B', 'waits for A -> X', true]]),
      frame('Order by stable account ID', 'Both acquire X before Y. B waits without owning Y, so A can finish and release both.', [['Thread A', 'X then Y -> finish', true], ['Locks', 'No wait cycle'], ['Thread B', 'wait X, then acquire Y']]),
    ],
    prediction: { prompt: 'Two transfers lock the source then destination account. What prevents a reversed-transfer deadlock?', options: ['Always acquire both accounts in stable ID order', 'Make balances volatile', 'Add a third nested lock per account'], answer: 0, why: 'A consistent order removes circular wait. Volatile cannot break a lock ownership cycle.' },
    recall: { prompt: 'When do you choose a lock instead of CAS or a concurrent collection?', answer: 'Use a lock for a multi-step/multi-field invariant and explicitly bound/observe contention. CAS fits a simple atomic state transition; a concurrent collection gives its documented operation-level guarantees. Senior signal: state the invariant, lock scope/order, timeout/cancellation policy and evidence from thread dumps.' },
    drill: { title: 'Two healthy accounts, one frozen service', evidence: 'Thread dump: worker-1 owns account A and waits on B; worker-2 owns B and waits on A. CPU is low; requests never finish.', prompt: 'Best diagnosis and durable fix?', options: ['CPU saturation; increase CPU', 'Deadlock; impose a consistent lock order', 'GC leak; change collector'], answer: 1, why: 'The ownership graph has a cycle. A thread dump distinguishes blocked locks from runnable CPU work; globally order acquisitions.' },
    source: 'https://docs.oracle.com/javase/21/docs/api/java.base/java/util/concurrent/package-summary.html',
  },
  {
    id: 'executors', domain: 'Java', title: 'Executors, futures and virtual threads',
    tagline: 'Concurrency is a resource budget, not a promise of faster CPU work.',
    theory: [
      'Pool size, queue bounds, rejection and downstream capacity are one design. Unbounded queues can hide overload as latency and memory growth. Timeouts and cancellation need explicit propagation.',
      'CompletableFuture non-async continuations may run on the completing thread; async methods without an explicit executor typically use the common pool. Blocking unrelated work there can starve other tasks.',
      'Tasks that submit child work to the same saturated fixed pool and then join can starve forever. Compose futures instead of blocking pool workers; separate blocking work and budget its concurrency.',
      'Virtual threads are final in Java 21 and improve concurrency for blocking I/O, not CPU parallelism. Do not pool them just to limit scarce resources: bound the database/API with a Semaphore. synchronized-related pinning changed in Java 24 (JEP 491); native/foreign blocking caveats remain version-dependent.',
    ],
    frames: [
      frame('Fill a two-worker pool', 'P1 and P2 each occupy a worker.', [['Worker 1', 'P1 running', true], ['Queue', 'empty'], ['Worker 2', 'P2 running', true]]),
      frame('Submit children', 'Both parents queue a child on the same executor.', [['Worker 1', 'P1 submitted C1'], ['Queue', 'C1, C2 waiting', true], ['Worker 2', 'P2 submitted C2']]),
      frame('Parents block on join', 'No worker is available to run either child. This is thread-pool starvation, even without a monitor deadlock.', [['Worker 1', 'join C1: blocked', true], ['Queue', 'C1, C2 cannot start'], ['Worker 2', 'join C2: blocked', true]]),
      frame('Compose; bound I/O', 'Release workers by chaining stages. For blocking I/O, virtual threads can park, but the downstream service still needs a concurrency cap.', [['Composition', 'thenCompose / completion stages', true], ['Virtual threads', 'Many waiting tasks, few carriers'], ['Database', 'Semaphore / connection pool limit']]),
    ],
    prediction: { prompt: 'Will 10,000 virtual threads make 10,000 CPU-bound tasks finish faster on eight cores?', options: ['Yes, each virtual thread adds a core', 'No, CPU parallelism is still bounded by cores', 'Yes, if the queue is unbounded'], answer: 1, why: 'Virtual threads reduce the cost of waiting, not CPU execution. Benchmark CPU and downstream bottlenecks separately.' },
    recall: { prompt: 'Design an executor policy for request fan-out to a slow dependency.', answer: 'Set bounded concurrency/queueing, deadline, rejection/backpressure, cancellation and observability (queue wait, active workers, timeouts). Avoid blocking joins on the pool that must run children. Use an explicit executor for blocking stages, or virtual threads with downstream limits. Explain throughput versus p99 latency, not just thread count.' },
    drill: { title: 'The future that never completes', code: 'var pool = Executors.newFixedThreadPool(2);\n// Two parent tasks run this concurrently:\npool.submit(() -> pool.submit(this::fetch).get());', evidence: 'Both workers wait in Future.get; child fetch tasks remain queued; the dependency itself is healthy.', prompt: 'What is the mechanism?', options: ['Java heap fragmentation', 'Same-pool parent/child starvation; compose instead of blocking workers', 'Virtual threads are mandatory for every task'], answer: 1, why: 'Queued children require occupied workers. Raising the pool size can postpone recurrence; change the dependency/continuation structure and bound work.' },
    source: 'https://openjdk.org/jeps/444',
  },
  {
    id: 'collections', domain: 'Java', title: 'HashMap: buckets, resize and mutable keys',
    tagline: 'Trace the bit that splits a bucket; explain the contract before the big-O.',
    theory: [
      'HashMap spreads the key hash, indexes a power-of-two table with (n - 1) & hash, then uses equals within a bucket. Equal keys must have equal hash codes; collisions are allowed.',
      'At the default load factor 0.75, exceeding the threshold typically grows capacity. When capacity doubles, a node stays at its old index or moves by oldCapacity according to (hash & oldCapacity).',
      'In OpenJDK HashMap, a sufficiently crowded bin may treeify around 8 entries only when capacity is at least 64; a smaller table resizes instead. These are implementation thresholds, not a Map API guarantee.',
      'HashMap is not thread-safe. ConcurrentHashMap uses CAS and bin coordination in modern JDKs, not the old fixed-segment explanation. Its iterators are weakly consistent; null keys/values are disallowed. ArrayList gives indexed access; LinkedList has traversal/allocation costs despite O(1) relinking once a node is found.',
    ],
    frames: [
      frame('Index capacity 4', 'Illustrative spread hashes: K1=1, K2=5. Both index to 1 because (4-1)&hash = 1.', [['Bucket 1', 'K1(h=1) -> K2(h=5)', true], ['Capacity', '4; mask 3'], ['Threshold', '3 at load factor .75']]),
      frame('Cross the size threshold', 'An insertion raises total map size to 4. The table doubles to 8 (unshown entries occupy other buckets).', [['Capacity', '4 -> 8', true], ['New mask', '7'], ['Old bucket 1', 'Split using bit 4']]),
      frame('Low-bit partition', 'K1 has (1 & 4)=0, so it remains at index 1.', [['Bucket 1', 'K1(h=1)', true], ['Bucket 5', 'empty'], ['Decision', 'hash & oldCapacity = 0']]),
      frame('High-bit partition', 'K2 has (5 & 4)!=0, so it moves to old index + oldCapacity = 5. User hashCode need not be called again for this split.', [['Bucket 1', 'K1(h=1)'], ['Bucket 5', 'K2(h=5)', true], ['Decision', '1 + 4 = 5']]),
    ],
    prediction: { prompt: 'At capacity 4, spread hash 5 is in bucket 1. After resizing to 8, where does it go?', options: ['Bucket 1 always', 'Bucket 5', 'Bucket 0 because every key is re-created'], answer: 1, why: '(5 & 4) != 0, so it moves from 1 to 1 + 4. Equivalently, (8-1)&5 = 5.' },
    recall: { prompt: 'Why does mutating a key break lookup, and does a concurrent map fix it?', answer: 'The node was placed using the old hash. A new hash can direct get to another bucket; changed equality also breaks the logical key contract. Use immutable key fields and stable equals/hashCode. ConcurrentHashMap protects concurrent operations, not mutable-key semantics. Senior signal: distinguish API contracts from JDK-specific treeification thresholds.' },
    drill: { title: 'The disappearing invoice', code: 'map.put(key, invoice);\nkey.setCustomerId("different");\nvar result = map.get(key);', evidence: 'customerId participates in equals/hashCode. The map still has one entry, but lookup may return null.', prompt: 'What fixes the design?', options: ['Use immutable keys with stable equality/hash', 'Replace HashMap with ConcurrentHashMap only', 'Set load factor to 1.0'], answer: 0, why: 'Stable identity is the invariant. Changing the map type or capacity does not repair a mutated hash/equality contract.' },
    source: 'https://github.com/openjdk/jdk/blob/jdk-21%2B35/src/java.base/share/classes/java/util/HashMap.java',
  },
  {
    id: 'language', domain: 'Java', title: 'Language contracts and stream laziness',
    tagline: 'Immutability, erasure and exceptions shape runtime behavior.',
    theory: [
      'Immutability requires protecting the complete reachable state: private final fields alone are insufficient if mutable collections escape. Defensive copies can be needed on both construction and access. Records are shallowly immutable carriers, not deeply immutable object graphs.',
      'Generics are largely erased: List<String> and List<Integer> share a runtime raw class. Compiler-inserted casts and bridge methods preserve typing; raw types and unchecked casts can defer failures. Use PECS: producer extends, consumer super.',
      'Stream intermediate operations are lazy; a terminal operation drives traversal, sometimes short-circuiting. Streams are single-use. Behavioral parameters should be non-interfering; peek is not a reliable place for mandatory business effects.',
      'Checked exceptions must be handled/declared; unchecked exceptions usually signal runtime failures. try-with-resources closes resources and preserves suppressed close exceptions. Sealed types constrain permitted subtypes and support exhaustive domain modeling; records do not replace entity identity/lifecycle design.',
    ],
    frames: [
      frame('Describe a pipeline', 'Creating filter/map stages does not traverse input.', [['Input', '1, 2, 3, 4'], ['Pipeline', 'filter even -> map x10', true], ['Result', 'No terminal operation yet']]),
      frame('Terminal findFirst starts', 'Traversal begins on demand. 1 fails the predicate.', [['Input cursor', '1 rejected', true], ['Pipeline', 'filter -> map'], ['Result', 'pending']]),
      frame('Process the first match', '2 passes and maps to 20.', [['Input cursor', '2 accepted'], ['Pipeline', 'map 2 -> 20', true], ['Result', '20']]),
      frame('Short-circuit', 'findFirst stops. 3 and 4 need not be visited; side effects on those elements cannot be assumed.', [['Input', '3, 4 unvisited'], ['Pipeline', 'closed for reuse'], ['Result', 'Optional[20]', true]]),
    ],
    prediction: { prompt: 'A stream uses filter(...).map(...).findFirst(). Must map run on every input element?', options: ['Yes, intermediate operations are eager', 'No, traversal can short-circuit', 'Only parallel streams can stop early'], answer: 1, why: 'The terminal operation requests only enough elements for the first result. Filtered-out elements never reach map.' },
    recall: { prompt: 'Is record Team(List<String> members) deeply immutable? Explain the fix and generics limit.', answer: 'No: the reference is final but the list may mutate. Copy at construction, e.g. List.copyOf, and ensure element state is immutable too. Generic type parameters usually do not exist as distinct runtime classes, so raw-type contamination can surface as a later ClassCastException. State both ownership and type-safety invariants.' },
    drill: { title: 'Immutable record, mutable reality', code: 'record Team(List<String> members) {}\nvar names = new ArrayList<String>();\nvar team = new Team(names);\nnames.add("unexpected");', evidence: 'A supposedly immutable snapshot changes after the caller mutates the original list.', prompt: 'Why?', options: ['Records always deep-copy constructor arguments', 'The record retains a mutable list reference; defensively copy', 'Generics force thread safety'], answer: 1, why: 'Records are shallowly immutable. A defensive copy protects list structure; mutable elements still need their own ownership policy.' },
    source: 'https://docs.oracle.com/javase/21/docs/api/java.base/java/util/stream/package-summary.html',
  },
  {
    id: 'beans', domain: 'Spring', title: 'IoC: bean lifecycle and scopes',
    tagline: 'The container owns creation; singleton does not mean thread-safe.',
    theory: [
      'The container builds bean definitions and resolves dependencies. Constructor injection makes required dependencies explicit and supports testability; constructor cycles usually indicate a design problem.',
      'For an ordinary initialized bean: construct, inject properties, Aware callbacks, before-initialization post-processing (including @PostConstruct), InitializingBean.afterPropertiesSet, custom init, then after-initialization post-processing which may expose a proxy.',
      'A Spring singleton is one instance per bean definition per container, not one per JVM and not automatically safe for concurrent requests. Prototype creates on lookup; injecting it once into a singleton does not magically create one per request.',
      'Request/session scopes depend on a web context; scoped proxies/providers defer access to the current instance. The container runs singleton destruction callbacks, but does not manage a prototype bean through full destruction.',
    ],
    frames: [
      frame('Construct', 'Definitions describe how to create instances; constructor dependencies must already be resolved.', [['Container', 'Resolve constructor dependencies', true], ['Instance', 'Constructor completes'], ['Exposed bean', 'Not yet ready']]),
      frame('Populate and initialize', 'Properties/field injection precedes initialization callbacks. @PostConstruct is invoked through post-processing.', [['Instance', 'Dependencies populated', true], ['Callbacks', '@PostConstruct -> afterPropertiesSet -> custom init'], ['Exposed bean', 'Still initializing']]),
      frame('Post-process for exposure', 'After-initialization processors can wrap the instance in an AOP proxy. Do not rely on transactional self-calls during initialization.', [['Post-processors', 'May wrap target', true], ['Target', 'Initialized service'], ['Exposed bean', 'Proxy or original instance']]),
      frame('Use then destroy', 'Concurrent requests can share a singleton; mutable request data must not live in shared fields.', [['Request A / B', 'Share singleton', true], ['Shutdown', '@PreDestroy for managed singleton'], ['Prototype', 'Caller manages destruction']]),
    ],
    prediction: { prompt: 'A singleton service stores currentUser in a field for each request. Does IoC make this safe?', options: ['Yes, dependency injection serializes calls', 'No, concurrent requests share the instance', 'Yes, if the constructor is public'], answer: 1, why: 'Scope controls lifetime, not synchronization. Keep request state local or appropriately request-scoped.' },
    recall: { prompt: 'Explain why a prototype dependency injected into a singleton is not fresh on every method call.', answer: 'Injection resolves that dependency when the singleton is created; the singleton keeps that reference. Use ObjectProvider or a suitable scoped proxy/lookup when you truly need deferred instances. Explain ownership, destruction and thread safety separately. Prefer constructor injection and avoid cycles rather than using injection style to hide them.' },
    order: { prompt: 'Order these callbacks for an ordinary bean with all three init hooks.', items: ['Construct and inject dependencies', '@PostConstruct', 'afterPropertiesSet', 'Custom init method', 'After-initialization post-processing / proxy exposure'], why: 'Before-init processors invoke @PostConstruct; then InitializingBean and custom init execute; after-init processors may expose a proxy. Aware callbacks and other post-processors are omitted from this simplified ordering.' },
    drill: { title: 'Users occasionally swap identities', code: '@Service\nclass Checkout {\n  String currentUser;\n  void buy(String user) { currentUser = user; /* ... */ }\n}', evidence: 'Only under concurrent traffic, one request is attributed to another user. Checkout uses default singleton scope.', prompt: 'What is the design flaw?', options: ['Singleton mutable request state; use local/request-scoped state', 'Too many bean definitions', 'Missing @Autowired on the field'], answer: 0, why: 'Requests race on a shared field. Injection does not provide mutual exclusion or isolation between request identities.' },
    source: 'https://docs.spring.io/spring-framework/reference/core/beans/factory-nature.html',
  },
  {
    id: 'boot', domain: 'Spring', title: 'Boot: conditions, configuration and tests',
    tagline: 'Auto-configuration is conditional wiring, not annotation magic.',
    theory: [
      'Starters curate dependencies; auto-configuration proposes bean definitions based on classpath, existing beans and properties. Many configurations back off when you define a bean. Read the conditions evaluation report when wiring differs from expectation.',
      '@SpringBootApplication combines configuration, auto-configuration and component scanning. Scan boundaries matter; an out-of-package component may never be discovered.',
      'External configuration has documented precedence, including property files, environment and command-line values. Profiles select configuration; they are not a secret store. Validate required configuration and avoid logging credentials.',
      '@WebMvcTest focuses on MVC and typically supplies mocked collaborators; @DataJpaTest focuses on persistence, commonly with test rollback. @SpringBootTest loads a full context. Slice tests do not prove full wiring or production database semantics; use integration tests for those boundaries.',
    ],
    frames: [
      frame('Classpath candidates', 'A starter makes relevant classes available; candidates are not unconditional beans.', [['Starter', 'Dependencies on classpath', true], ['Auto-config', 'Candidate definitions'], ['Application', 'Own bean definitions']]),
      frame('Evaluate conditions', 'Classpath, properties and missing-bean conditions decide whether the candidate applies.', [['Conditions', 'Class present? property enabled? bean absent?', true], ['Report', 'Matched / did not match'], ['Application', 'Custom DataSource exists']]),
      frame('Back off', 'A matching custom bean can cause the default to back off; inspect the report rather than guessing.', [['Auto-config', 'Default DataSource not created'], ['Application', 'Custom DataSource selected', true], ['Configuration', 'Resolved external properties']]),
      frame('Test the right boundary', 'MVC slices, persistence slices and full integration have different responsibilities.', [['MVC slice', 'Routing / validation / advice'], ['JPA slice', 'Mappings / queries'], ['Integration', 'Real wiring / database behavior', true]]),
    ],
    prediction: { prompt: 'Why might Boot not create its default DataSource even though a JDBC starter is installed?', options: ['A user-defined DataSource makes a missing-bean condition fail', 'Starters always disable databases', 'Component scanning rewrites JDBC code'], answer: 0, why: 'Auto-configuration frequently backs off for user-provided beans. Check the conditions report and configuration rather than adding annotations blindly.' },
    recall: { prompt: 'What does a passing @WebMvcTest not prove?', answer: 'It proves behavior in its MVC-focused slice, not full service/repository wiring, transaction boundaries or production database semantics. Pair cheap focused tests with selected @SpringBootTest/integration tests at critical boundaries. Senior signal: debug configuration via condition outcomes, scan boundaries and property precedence rather than trial-and-error annotations.' },
    drill: { title: 'Green slice, broken startup', evidence: 'Controller tests mock PaymentService and pass. Production fails to find PaymentService because its package is outside component scanning.', prompt: 'Which test would catch the missing wiring?', options: ['Another controller test with the same mock', 'A context/integration test with real application wiring', 'A static string assertion on the annotation'], answer: 1, why: 'The slice intentionally replaces the dependency. A real application-context test exposes scanning/wiring failures.' },
    source: 'https://docs.spring.io/spring-boot/reference/using/auto-configuration.html',
  },
  {
    id: 'proxy', domain: 'Spring', title: 'AOP: the self-invocation trap',
    tagline: 'Trace the call boundary before reasoning about an annotation.',
    theory: [
      'In default Spring AOP proxy mode, advice runs when a call crosses the proxy. A target invoking this.otherMethod() does not re-enter that proxy.',
      'JDK proxies expose interfaces; class-based proxies subclass the target. Final/private methods cannot be advised through subclass overrides. Method visibility support differs by proxy type and Spring version.',
      'A self-call to @Transactional or @Async does not apply that method advice in default proxy mode. If an outer transaction already exists, the self-call can still execute inside it; it simply does not apply the inner annotation.',
      'Extract the boundary into another injected bean or use explicit programmatic transaction management. AspectJ weaving is a different interception model, not the default proxy behavior.',
    ],
    frames: [
      frame('Caller reaches the proxy', 'An external call enters checkout(). Assume checkout itself is not transactional.', [['Caller', 'controller.checkout()', true], ['Proxy', 'No transaction for checkout'], ['Target', 'checkout begins']]),
      frame('Target self-invokes', 'checkout calls this.charge(). The call stays within the target and bypasses the proxy.', [['Target', 'this.charge()', true], ['Proxy', 'Not traversed'], ['Database', 'No transaction from inner annotation']]),
      frame('Annotation is not advice', 'The inner @Transactional metadata exists but no transaction interceptor saw the call.', [['Annotation', '@Transactional on charge'], ['Interceptor', 'Not invoked', true], ['Outcome', 'No new boundary established']]),
      frame('Cross an explicit boundary', 'Checkout delegates to an injected PaymentService proxy; its interceptor can now begin/complete the transaction.', [['Caller', 'checkout target -> payment proxy'], ['Proxy', 'Begin -> invoke -> commit/rollback', true], ['Target', 'charge inside transaction']]),
    ],
    prediction: { prompt: 'A nontransactional method calls this.save(), annotated @Transactional. In default proxy mode, is a transaction started by that annotation?', options: ['Yes, annotations intercept every call', 'No, self-invocation bypasses the proxy', 'Only if save is final'], answer: 1, why: 'The target self-call never crosses the proxy. Extract an injected boundary or use programmatic transactions.' },
    recall: { prompt: 'If the outer method is already transactional, what happens to a self-called REQUIRES_NEW method?', answer: 'Its annotation is bypassed, so no independent transaction is started; the code runs within the outer transaction if one exists. The issue is missing inner advice, not necessarily no transaction at all. Senior signal: draw caller -> proxy -> target and distinguish default proxy mode from AspectJ weaving.' },
    drill: { title: 'The audit that rolled back', code: '@Transactional\npublic void checkout() {\n  this.audit();\n  throw new RuntimeException();\n}\n@Transactional(propagation = REQUIRES_NEW)\npublic void audit() { /* insert audit */ }', evidence: 'Audit rows disappear with checkout rollback; both methods belong to the same bean using default proxy mode.', prompt: 'Why did the audit not commit independently?', options: ['REQUIRES_NEW always shares the physical transaction', 'The self-call bypassed inner advice; extract an injected audit bean', 'Checked exceptions always roll back by default'], answer: 1, why: 'checkout has an outer transaction, but audit does not cross the proxy to apply REQUIRES_NEW. A separate intercepted bean creates the independent boundary; consider its connection-pool cost.' },
    source: 'https://docs.spring.io/spring-framework/reference/core/aop/proxying.html',
  },
  {
    id: 'transactions', domain: 'Spring', title: 'Transactions: logical versus physical',
    tagline: 'Predict rollback-only, suspension and connection demand.',
    theory: [
      'REQUIRED joins an existing physical transaction or starts one. Each intercepted logical scope can mark the shared transaction rollback-only. Catching the inner exception does not necessarily clear that flag.',
      'REQUIRES_NEW suspends the outer scope and creates an independent physical transaction. The outer connection remains held while the inner may need another; pool exhaustion is a real production risk.',
      'NESTED commonly uses savepoints in the same physical transaction when supported by the transaction manager/resource. It is not an independently committed transaction; support is not universal, particularly for JPA.',
      'Default Spring rollback rules roll back on RuntimeException and Error, not checked exceptions; configure rollbackFor where intended (global defaults can be customized). Isolation uses database semantics; REQUIRED generally joins outer isolation. readOnly is typically a hint/optimization, not a universal write prohibition.',
    ],
    frames: [
      frame('Outer REQUIRED begins', 'An intercepted service method starts physical transaction T1 on connection C1.', [['Outer logical scope', 'T1', true], ['Connection pool', 'C1 held'], ['Inner scope', 'not entered']]),
      frame('Inner REQUIRED joins', 'A call through another bean proxy joins T1; it does not obtain an independent transaction.', [['Outer logical scope', 'T1'], ['Physical transaction', 'shared T1', true], ['Inner logical scope', 'T1']]),
      frame('Inner marks rollback-only', 'An unchecked failure crossing the inner interceptor marks T1 rollback-only. The outer method catches the exception.', [['Outer logical scope', 'caught exception'], ['Physical transaction', 'T1 rollback-only', true], ['Inner logical scope', 'failed']]),
      frame('Outer tries to commit', 'Rollback-only wins. UnexpectedRollbackException tells the caller that a commit did not happen.', [['Outer commit', 'Cannot commit T1', true], ['Database', 'ROLLBACK'], ['Caller', 'UnexpectedRollbackException']]),
    ],
    prediction: { prompt: 'An intercepted inner REQUIRED method throws a runtime exception; the outer REQUIRED catches it and returns normally. Can the shared rollback-only transaction commit?', options: ['Yes, catching always clears rollback-only', 'No, outer commit can throw UnexpectedRollbackException', 'Yes, if the inner method is public'], answer: 1, why: 'The inner interceptor can mark the shared physical transaction rollback-only. Catching the exception does not undo the flag.' },
    recall: { prompt: 'Contrast REQUIRED, REQUIRES_NEW and NESTED, including a production hazard.', answer: 'REQUIRED joins a physical transaction; rollback-only can propagate to its outer caller. REQUIRES_NEW uses an independent transaction while suspending outer resources, increasing connection demand. NESTED uses savepoints in the same physical transaction when supported; outer rollback still rolls back all. State manager/database capabilities, rollback rules and pool budget before choosing.' },
    order: { prompt: 'Reconstruct the REQUIRED rollback-only incident.', items: ['Outer interceptor begins T1', 'Inner interceptor joins T1', 'Inner runtime failure marks T1 rollback-only', 'Outer catches exception and returns', 'Outer commit rolls back and reports UnexpectedRollbackException'], why: 'Separate logical scopes can share one physical transaction. Normal outer return is not proof that the database can commit.' },
    drill: { title: 'The pool with no free connections', evidence: '20 concurrent requests each hold an outer transaction connection. Pool size is 20. Each calls a separate proxied REQUIRES_NEW audit service and waits for another connection.', prompt: 'What is the immediate bottleneck and design response?', options: ['Connection starvation; budget independent transaction demand and redesign the audit boundary', 'HashMap collisions; treeify bins', 'JIT warmup; disable compilation'], answer: 0, why: 'Outer connections remain held while inner transactions request new ones. Measure acquisition timeouts, bound concurrency and evaluate alternatives such as an outbox; increasing size must respect database capacity.' },
    source: 'https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html',
  },
  {
    id: 'mvc', domain: 'Spring', title: 'MVC request flow and WebFlux choice',
    tagline: 'Filters wrap the servlet; interceptors are inside MVC dispatch.',
    theory: [
      'Servlet filters wrap the chain before DispatcherServlet. DispatcherServlet selects a handler and adapter; MVC interceptors surround handler execution, not the entire container filter chain.',
      'Argument resolvers, binding and validation prepare handler arguments. Return-value handling/message converters produce the response; HandlerExceptionResolver can apply @ControllerAdvice exception handling.',
      '@ControllerAdvice does not automatically catch failures thrown before DispatcherServlet, including many security/filter failures. Async dispatch and streaming introduce additional lifecycle details; the visual shows a normal synchronous MVC request.',
      'WebFlux uses reactive/nonblocking contracts and a different stack (WebFilter and DispatcherHandler). Blocking JDBC/JPA work on an event loop can starve unrelated requests. MVC can be a good fit for blocking stacks, optionally with virtual threads; choose by workload and end-to-end libraries, not novelty.',
    ],
    frames: [
      frame('Servlet filter chain', 'Logging/security filters can inspect, reject or continue the request before MVC begins.', [['Request', 'HTTP request'], ['Filters', 'Security -> next filter -> servlet', true], ['MVC', 'Not reached if filter rejects']]),
      frame('DispatcherServlet routes', 'HandlerMapping finds a controller; HandlerAdapter knows how to invoke it.', [['DispatcherServlet', 'Mapping + adapter', true], ['Interceptor', 'preHandle'], ['Controller', 'Arguments resolved/validated']]),
      frame('Handler returns or throws', 'Controller delegates to services. MVC resolvers can route an exception to advice.', [['Controller', 'Service call', true], ['Exception path', 'Resolver -> @ControllerAdvice'], ['Success path', 'Return value handling']]),
      frame('Serialize and unwind', 'A converter writes the response; interceptor completion and surrounding filters finish their lifecycles.', [['Converter', 'JSON response', true], ['Interceptor', 'Completion callback'], ['Filters', 'Unwind surrounding chain']]),
    ],
    prediction: { prompt: 'A security filter rejects a request before DispatcherServlet. Will a controller @ExceptionHandler automatically handle that filter exception?', options: ['Yes, all exceptions enter MVC', 'No, it is outside normal MVC exception resolution', 'Only when the controller returns JSON'], answer: 1, why: 'Security/filter failures need the appropriate filter-chain handlers, such as an AuthenticationEntryPoint or AccessDeniedHandler.' },
    recall: { prompt: 'When does WebFlux fail to improve concurrency, and how do filters differ from interceptors?', answer: 'Blocking calls on event-loop threads stall unrelated work; reactive benefits require compatible nonblocking dependencies or carefully bounded offloading. Servlet filters surround dispatch; MVC interceptors run around mapped handlers inside DispatcherServlet. Senior signal: trace thread usage and blocking dependencies before recommending a framework migration.' },
    order: { prompt: 'Order the normal synchronous MVC success path (some details omitted).', items: ['Servlet filters before the servlet', 'DispatcherServlet selects handler and adapter', 'Interceptor preHandle', 'Resolve arguments and invoke controller', 'Handle return value / serialize response', 'Completion and surrounding filters unwind'], why: 'Filters sit outside MVC. Handler mapping precedes MVC interceptor execution; response handling and lifecycle completion occur after the handler.' },
    drill: { title: 'Reactive endpoint, blocked event loop', code: '// Executed directly in a WebFlux handler:\nvar orders = blockingJpaRepository.findAll();\nreturn Mono.just(orders);', evidence: 'Event-loop thread stacks show blocking database calls. Other endpoints become slow despite low CPU.', prompt: 'Best explanation?', options: ['Mono.just makes the database call nonblocking', 'The blocking call already ran on the event loop; use a compatible stack or bounded offloading', 'All MVC interceptors need more priority'], answer: 1, why: 'Wrapping an already executed call does not change its thread or I/O behavior. Consider MVC for an otherwise blocking JPA stack; offloading must be explicit and capacity-limited.' },
    source: 'https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html',
  },
  {
    id: 'jpa', domain: 'Spring', title: 'JPA: identity map, flush and N+1',
    tagline: 'Persistence context tracks objects; SQL timing and fetch plans matter.',
    theory: [
      'A persistence context tracks managed entities and identity: one managed instance per entity identity within that context. It is not a general distributed cache and is not thread-safe.',
      'Dirty checking compares managed state and can generate updates at flush. flush synchronizes SQL with the database inside the transaction; it is not commit. Detached mutations are not automatically tracked.',
      'Lazy associations defer fetching until accessed; access after the context closes can fail. Open Session in View may hide that boundary and trigger unexpected queries during rendering, not solve query design.',
      'N+1 is a query-count problem: one parent query plus N association fetches. Use measured fetch joins/entity graphs/projections/batch fetching. Fetching multiple collections can explode rows; collection fetch joins and pagination need care. Indexes alone do not remove round trips.',
    ],
    frames: [
      frame('Query three orders', 'One query returns three managed Order entities; customers are lazy and not yet initialized.', [['SQL count', '1', true], ['Context', 'O1, O2, O3 managed'], ['Customer links', 'lazy, lazy, lazy']]),
      frame('Traverse associations', 'Assume three distinct customers, no second-level cache and no batching: accessing each customer issues another query.', [['SQL count', '1 + 3 = 4', true], ['Context', 'Orders + customers'], ['Serializer', 'Accesses customer names']]),
      frame('Mutate and flush', 'Changing a managed order can be detected at flush; the transaction can still roll back afterward.', [['Managed O1', 'status changed', true], ['Flush', 'UPDATE sent'], ['Commit', 'Not implied by flush']]),
      frame('Use a measured fetch plan', 'For this bounded result and a to-one customer association, a fetch join/projection can remove the per-row queries.', [['SQL count', '1 planned query', true], ['Fetch plan', 'Order + customer in query'], ['Caution', 'Collections / pagination need a different plan']]),
    ],
    prediction: { prompt: 'One query loads 3 orders with 3 distinct lazy customers. With no cache/batching, accessing every customer causes how many total SELECTs?', options: ['1', '3', '4'], answer: 2, why: 'One order query plus three customer loads is 4. State assumptions: duplicates, caches and batch fetching change the count.' },
    recall: { prompt: 'Why is flush not commit, and what makes a good N+1 fix?', answer: 'Flush emits SQL for managed changes within the transaction; commit finalizes it, while rollback can still undo flushed changes. Measure query count and rows, choose a use-case fetch plan/projection, and verify pagination and memory costs. EAGER is not a universal fix and indexes do not eliminate N extra round trips.' },
    drill: { title: 'Fast database, slow list endpoint', evidence: 'List endpoint returns 100 orders. SQL log: 1 order SELECT plus 100 customer SELECTs. Individual queries are fast; response spends time on round trips.', prompt: 'What is the most direct fix to evaluate?', options: ['Blindly change all associations to EAGER', 'A targeted fetch join/entity graph/projection; assert query count and result correctness', 'Raise the servlet timeout only'], answer: 1, why: 'The access pattern creates N+1. Target the actual read model and verify bounded queries, row explosion and pagination behavior.' },
    source: 'https://docs.hibernate.org/orm/6.6/userguide/html_single/Hibernate_User_Guide.html#fetching',
  },
  {
    id: 'security', domain: 'Spring', title: 'Security and observability boundaries',
    tagline: 'Authentication precedes authorization; metrics must expose the bottleneck safely.',
    theory: [
      'Servlet security is a filter-chain concern. FilterChainProxy selects a matching SecurityFilterChain; ordering/matchers determine which chain applies. Authentication establishes identity; authorization decides access.',
      'A 401 generally means authentication is needed/failed; 403 generally means access is denied (including possible CSRF failures). Stateless bearer APIs and browser cookie sessions have different CSRF/session requirements; do not disable protections indiscriminately.',
      'Actuator exposes management endpoints subject to exposure and security configuration. Separate liveness (process viable) from readiness (can accept traffic). Dependency outages should not blindly make liveness restart every instance.',
      'Use latency distributions, request/error rates, traces and resource metrics together. Track executor queue wait, connection acquisition and SQL count for these incidents. Avoid high-cardinality user IDs as metric tags and never expose secrets in logs or management endpoints.',
    ],
    frames: [
      frame('Choose the matching chain', 'The first matching configured chain handles the request. More-specific matchers need deliberate ordering.', [['Request', '/api/orders'], ['FilterChainProxy', 'Select API security chain', true], ['Other chains', 'Not also applied automatically']]),
      frame('Authenticate', 'A bearer filter validates the credential and establishes security context according to its configured policy.', [['Credential', 'Token'], ['Authentication', 'Validate identity', true], ['Context', 'Principal / authorities']]),
      frame('Authorize', 'Authorization checks the request against the selected policy. Successful login does not imply permission for every endpoint.', [['Principal', 'Authenticated user'], ['Authorization', 'Required authority?', true], ['Outcome', 'Continue or deny']]),
      frame('Observe without leaking', 'A trace connects request latency to database/pool spans; low-cardinality metrics aggregate symptoms.', [['Metrics', 'p99 / errors / pool wait', true], ['Trace', 'Request -> service -> database'], ['Management', 'Minimal secured exposure']]),
    ],
    prediction: { prompt: 'A user has a valid token but lacks the required role. Does successful authentication imply authorization?', options: ['Yes, every valid token is admin', 'No, the access policy can still deny the request', 'Only actuator endpoints need authorization'], answer: 1, why: 'Identity and permission are separate decisions. Diagnose the selected chain, matcher and granted authorities.' },
    recall: { prompt: 'Which signals distinguish slow SQL from connection-pool starvation, and what should readiness do?', answer: 'Separate connection-acquisition wait from query execution time; inspect pool active/pending metrics and trace spans. Readiness can withhold traffic when necessary dependencies prevent serving; liveness should indicate whether restarting this process helps. Secure management endpoints and avoid sensitive/high-cardinality labels.' },
    order: { prompt: 'Assemble a simplified servlet security request path, not an exhaustive version-specific filter list.', items: ['Match request to SecurityFilterChain', 'Establish authenticated SecurityContext', 'Evaluate authorization policy', 'Continue to servlet/MVC if permitted'], why: 'The chain is selected first, identity is established before access is evaluated, and only permitted requests reach the application. Real chains contain additional context, exploit-protection and exception-handling filters.' },
    drill: { title: 'The restart storm', evidence: 'A shared database is temporarily unavailable. Every instance marks liveness DOWN and restarts repeatedly, losing warm caches and making recovery slower.', prompt: 'What is the better health policy?', options: ['Restart every instance faster', 'Use readiness to stop traffic; keep liveness about recoverability of this process', 'Expose every actuator endpoint publicly'], answer: 1, why: 'A process restart does not repair a shared database. Separate health semantics, secure endpoints and verify recovery without a restart cascade.' },
    source: 'https://docs.spring.io/spring-security/reference/servlet/architecture.html',
  },
];

export const topicById = (id: string) => TOPICS.find((topic) => topic.id === id);

export const SOURCES = [
  { title: 'Learning Scientists: six evidence-based strategies', url: 'https://www.learningscientists.org/blog/2016/8/18-1', note: 'Spacing and retrieval have the strongest evidence; interleaving, examples and dual coding support this design.' },
  { title: 'Learning Scientists: retrieval practice', url: 'https://www.learningscientists.org/blog/2016/6/23-1', note: 'Retrieve before looking; include relationships and applications, not only definitions.' },
  { title: 'Carnegie Mellon: research-based learning principles', url: 'https://www.cmu.edu/teaching/principles/learning.html', note: 'Organized knowledge, targeted practice/feedback and integrating component skills support transfer.' },
];
