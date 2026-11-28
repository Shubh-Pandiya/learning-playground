import { useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Button, Callout, CodeBlock } from '@/shared/ui';
import type { RecallGrade } from '@/shared/progress';
import type { Question, Topic } from './data';
import { useJava } from './store';

type GradeHandler = (grade: RecallGrade, confident: boolean, correct: boolean) => void;

function Confidence({ value, onChange, disabled }: { value: boolean | null; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-xs font-mono text-muted">Before checking: how confident are you?</legend>
      <div className="flex gap-2">
        <Button size="sm" active={value === false} onClick={() => onChange(false)}>Unsure</Button>
        <Button size="sm" active={value === true} onClick={() => onChange(true)}>Confident</Button>
      </div>
    </fieldset>
  );
}

function Ratings({ correct, disabled, onGrade }: { correct: boolean; disabled: boolean; onGrade: (grade: RecallGrade) => void }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Recall rating">
      {(['Forgot', 'Hard', 'Good', 'Easy'] as const).map((label, grade) => (
        <Button key={label} size="sm" disabled={disabled || (!correct && grade !== 0)} onClick={() => onGrade(grade as RecallGrade)}>
          {label}
        </Button>
      ))}
    </div>
  );
}

export function Prediction({ question, onGraded }: { question: Question; onGraded: GradeHandler }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [confident, setConfident] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);
  const [graded, setGraded] = useState(false);
  const correct = choice === question.answer;
  return (
    <div className="space-y-4">
      <h3 className="font-mono font-semibold">{question.prompt}</h3>
      <div className="grid gap-2" role="group" aria-label="Answer choices">
        {question.options.map((option, i) => (
          <button key={option} type="button" aria-pressed={choice === i} disabled={checked} onClick={() => setChoice(i)}
            className={`rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-default ${choice === i ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-accent/50'}`}>
            <span className="mr-2 font-mono text-muted">{String.fromCharCode(65 + i)}.</span>{option}
          </button>
        ))}
      </div>
      <Confidence value={confident} onChange={setConfident} disabled={checked} />
      {!checked ? (
        <Button variant="primary" disabled={choice === null || confident === null} onClick={() => setChecked(true)}>Check prediction</Button>
      ) : (
        <div className="space-y-3" aria-live="polite">
          <Callout tone={correct ? 'ok' : 'warn'} title={correct ? 'Prediction confirmed' : 'Update the mental model'}>
            <p className="text-sm">{question.why}</p>
            {!correct && <p className="mt-2 text-sm">Correct answer: {question.options[question.answer]}</p>}
          </Callout>
          <p className="text-xs text-muted">Rate the recall to schedule it and continue. Wrong answers return as Forgot, regardless of confidence.</p>
          <Ratings correct={correct} disabled={graded} onGrade={(grade) => {
            setGraded(true);
            onGraded(grade, confident === true, correct);
          }} />
          {graded && <p className="text-xs text-ok">Recorded and scheduled for review.</p>}
        </div>
      )}
    </div>
  );
}

export function Recall({ topic, onGraded }: { topic: Topic; onGraded: GradeHandler }) {
  const [attempt, setAttempt] = useState('');
  const [spoken, setSpoken] = useState(false);
  const [confident, setConfident] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState(false);
  return (
    <div className="space-y-4">
      <h3 className="font-mono font-semibold">{topic.recall.prompt}</h3>
      {!revealed && <>
        <p className="text-sm text-muted">Explain the mechanism, a failure mode, and the tradeoff from memory. This is concept recall, not code writing.</p>
        <textarea aria-label="Your concept explanation" rows={4} value={attempt} onChange={(e) => setAttempt(e.target.value)} placeholder="Optional: capture your explanation in your own words..."
          className="w-full rounded-lg border border-line bg-sunken p-3 text-sm text-ink" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spoken} onChange={(e) => setSpoken(e.target.checked)} />I explained it aloud before revealing.</label>
        <Confidence value={confident} onChange={setConfident} disabled={false} />
        <Button variant="primary" disabled={(!spoken && !attempt.trim()) || confident === null} onClick={() => setRevealed(true)}>Reveal senior answer</Button>
      </>}
      {revealed && <div className="space-y-3" aria-live="polite">
        <Callout tone="tip" title="Senior signal"><p className="text-sm leading-relaxed">{topic.recall.answer}</p></Callout>
        <p className="text-xs text-muted">Self-assess against the answer: Forgot = missing mechanism; Hard = partial; Good = explained with effort; Easy = complete and effortless. This is not an automated evaluation of your text.</p>
        <Ratings correct disabled={graded} onGrade={(grade) => {
          setGraded(true);
          onGraded(grade, confident === true, grade > 0);
        }} />
        {graded && <p className="text-xs text-ok">Recall saved. Revisit it on its due date.</p>}
      </div>}
    </div>
  );
}

function SortableRow({ id, index, length, move }: { id: string; index: number; length: number; move: (from: number, to: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-lg border border-line bg-surface p-3 ${isDragging ? 'relative z-10 shadow-lift' : ''}`}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${id}`} className="touch-none cursor-grab text-muted"><GripVertical size={18} /></button>
      <span className="font-mono text-xs text-accent">{index + 1}</span>
      <span className="flex-1 text-sm">{id}</span>
      <Button size="xs" iconOnly icon={<ArrowUp size={14} />} aria-label={`Move ${id} up`} disabled={index === 0} onClick={() => move(index, index - 1)} />
      <Button size="xs" iconOnly icon={<ArrowDown size={14} />} aria-label={`Move ${id} down`} disabled={index === length - 1} onClick={() => move(index, index + 1)} />
    </li>
  );
}

export function Ordering({ topic }: { topic: Topic & { order: NonNullable<Topic['order']> } }) {
  const [items, setItems] = useState(() => [...topic.order.items].reverse());
  const [checked, setChecked] = useState(false);
  const state = useJava();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const correct = items.every((item, i) => item === topic.order.items[i]);
  const move = (from: number, to: number) => {
    setItems((current) => arrayMove(current, from, to));
    setChecked(false);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) move(items.indexOf(String(active.id)), items.indexOf(String(over.id)));
  };
  return (
    <div className="space-y-4">
      <h3 className="font-mono font-semibold">{topic.order.prompt}</h3>
      <p className="text-xs text-muted">Drag the handles, use Space/arrow keys, or use the move buttons. Explain why each boundary precedes the next.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">{items.map((item, i) => <SortableRow key={item} id={item} index={i} length={items.length} move={move} />)}</ol>
        </SortableContext>
      </DndContext>
      <Button variant="primary" onClick={() => { setChecked(true); if (correct) state.order(topic.id); }}>Check assembly</Button>
      {checked && <Callout tone={correct ? 'ok' : 'warn'} title={correct ? 'Mechanism assembled' : 'One boundary is misplaced'}>
        <p className="text-sm">{correct ? topic.order.why : `First mismatch at step ${items.findIndex((item, i) => item !== topic.order.items[i]) + 1}. Expected: ${topic.order.items[items.findIndex((item, i) => item !== topic.order.items[i])]}. Reorder and try again.`}</p>
      </Callout>}
    </div>
  );
}

export function Incident({ topic, onGraded }: { topic: Topic; onGraded: GradeHandler }) {
  return <div className="space-y-4">
    <Callout tone="info" title="Production evidence"><p className="text-sm">{topic.drill.evidence}</p></Callout>
    {topic.drill.code && <CodeBlock language="java" code={topic.drill.code} />}
    <Prediction question={topic.drill} onGraded={onGraded} />
  </div>;
}
