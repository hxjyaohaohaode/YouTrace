import { useEffect, useMemo, useState } from 'react';

const GLYPHS = '01▮▯░▒▓│┤╡╢╖╕╣║╗╝╜┐└┴┬├─┼╞╟╚╔╩╦╠═╬§';

export function useScrambleText(target: string, enabled: boolean, durationMs = 900): string {
  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const [display, setDisplay] = useState(() =>
    !enabled || !target || reduced ? target : ''
  );

  useEffect(() => {
    if (!enabled || !target || reduced) {
      const raf = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(raf);
    }

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const revealed = Math.floor(t * target.length);
      let out = '';
      for (let i = 0; i < target.length; i += 1) {
        const ch = target[i];
        out += i < revealed || /\s/.test(ch)
          ? ch
          : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setDisplay(out);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, durationMs, reduced]);

  return display;
}
