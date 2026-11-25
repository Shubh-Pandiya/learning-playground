import { useEffect, useState } from 'react';

/** A frame counter for the "live" log animation. Pauses when `on` is false or the tab is hidden. */
export function useTick(on: boolean, ms = 650): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => {
      if (!document.hidden) setT((x) => x + 1);
    }, ms);
    return () => clearInterval(h);
  }, [on, ms]);
  return t;
}
