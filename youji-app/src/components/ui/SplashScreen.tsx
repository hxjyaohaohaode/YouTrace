import { useEffect, useRef } from 'react';
import { Brand } from './Brand';

interface SplashScreenProps { onComplete: () => void }

/** Animate the actual original artwork: no recreated circles, lettering or colors. */
function SplashScreen({ onComplete }: SplashScreenProps) {
  const artworkRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  const startedInThisMount = useRef(false);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    const shown = sessionStorage.getItem('youji_splash_shown') === 'true';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sessionStorage.setItem('youji_splash_shown', 'true');
    if ((shown && !startedInThisMount.current) || reduced) { onCompleteRef.current(); return; }
    // StrictMode replays effects on this same mount; restart the cancelled frame,
    // rather than mistaking our own session flag for an earlier visit.
    startedInThisMount.current = true;
    const artwork = artworkRef.current;
    const container = containerRef.current;
    if (!artwork || !container) { onCompleteRef.current(); return; }
    const circles = Array.from(artwork.querySelectorAll('circle'));
    const labels = Array.from(artwork.querySelectorAll('text'));
    labels.forEach(label => { label.style.opacity = '0'; });
    const easeOut = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const clamp = (t: number) => Math.max(0, Math.min(t, 1));
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const elapsed = now - start;
      // Preserve original 600/500/900/1200/1500 ms phases and 1800 ms total.
      circles.forEach((circle, index) => {
        if (!index) { circle.style.opacity = String(easeOut(clamp((elapsed - 100) / 300))); return; }
        const length = 2 * Math.PI * Number(circle.getAttribute('r'));
        circle.style.strokeDasharray = String(length);
        circle.style.strokeDashoffset = String(length * (1 - easeOut(clamp((elapsed - index * 80) / 350))));
      });
      const shrink = easeInOut(clamp((elapsed - 500) / 400));
      const center = easeInOut(clamp((elapsed - 1200) / 300));
      artwork.style.transform = `scale(${1 - .3 * shrink + .3 * center}) translateX(${-10 * shrink * (1 - center)}%)`;
      const reveal = easeOut(clamp((elapsed - 900) / 400));
      labels.forEach(label => { label.style.opacity = String(reveal); label.style.transform = `translateY(${(1 - reveal) * 15}px)`; });
      container.style.opacity = String(1 - easeInOut(clamp((elapsed - 1500) / 300)));
      if (elapsed >= 1800) { onCompleteRef.current(); return; }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={containerRef} className="splash-screen" aria-hidden><Brand variant="full" animated artworkRef={artworkRef} /></div>;
}
export default SplashScreen;
