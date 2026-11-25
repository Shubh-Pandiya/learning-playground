import { useCallback, useEffect, useRef, useState } from 'react';

export interface StepperOptions {
  /** Base milliseconds per step at speed 1×. Default 900. */
  intervalMs?: number;
  initialStep?: number;
  initialSpeed?: number;
  /** Loop back to 0 at the end instead of stopping. */
  loop?: boolean;
}

export interface Stepper {
  step: number;
  total: number;
  playing: boolean;
  speed: number;
  atStart: boolean;
  atEnd: boolean;
  next: () => void;
  prev: () => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  goTo: (i: number) => void;
  setSpeed: (s: number) => void;
}

/**
 * Drives a step-through animation (algorithm trace, request flow, …).
 * Pair with <StepControls stepper={…} />. `total` = number of steps (frames).
 */
export function useStepper(total: number, opts: StepperOptions = {}): Stepper {
  const { intervalMs = 900, initialStep = 0, initialSpeed = 1, loop = false } = opts;
  const [step, setStep] = useState(initialStep);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  const last = Math.max(0, total - 1);

  // Clamp when the trace changes length.
  useEffect(() => {
    setStep((s) => Math.min(s, last));
  }, [last]);

  const totalRef = useRef(total);
  totalRef.current = total;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        const end = Math.max(0, totalRef.current - 1);
        if (s >= end) {
          if (loop) return 0;
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, intervalMs / speed);
    return () => window.clearInterval(id);
  }, [playing, intervalMs, speed, loop]);

  const next = useCallback(() => setStep((s) => Math.min(s + 1, Math.max(0, totalRef.current - 1))), []);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);
  const goTo = useCallback((i: number) => setStep(Math.max(0, Math.min(i, Math.max(0, totalRef.current - 1)))), []);
  const reset = useCallback(() => {
    setPlaying(false);
    setStep(0);
  }, []);
  const play = useCallback(() => {
    setStep((s) => (s >= Math.max(0, totalRef.current - 1) ? 0 : s));
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  return {
    step,
    total,
    playing,
    speed,
    atStart: step === 0,
    atEnd: step >= last,
    next,
    prev,
    play,
    pause,
    toggle,
    reset,
    goTo,
    setSpeed,
  };
}
