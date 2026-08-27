import { useEffect, useCallback, useRef } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

const CIRCLE_CONFIGS = [
  { r: 16, type: 'fill' as const },
  { r: 40, type: 'stroke' as const, strokeWidth: 5, opacity: 0.55 },
  { r: 68, type: 'stroke' as const, strokeWidth: 4, opacity: 0.3 },
  { r: 100, type: 'stroke' as const, strokeWidth: 3, opacity: 0.14 },
];

const CIRCUMFERENCES = CIRCLE_CONFIGS.map(c => 2 * Math.PI * c.r);

function SplashScreen({ onComplete }: SplashScreenProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const circlesRef = useRef<(SVGCircleElement | null)[]>([]);
  const textRef = useRef<SVGGElement>(null);
  const chineseTextRef = useRef<SVGTextElement>(null);
  const englishTextRef = useRef<SVGTextElement>(null);
  const startTimeRef = useRef<number>(0);
  const animationRef = useRef<number>(0);
  const hasCompletedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const easeOutExpo = useCallback((t: number): number => {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }, []);

  const easeInOutCubic = useCallback((t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const alreadyShown = sessionStorage.getItem('youji_splash_shown') === 'true';
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (alreadyShown || prefersReducedMotion) {
      sessionStorage.setItem('youji_splash_shown', 'true');
      hasCompletedRef.current = true;
      onCompleteRef.current();
      return;
    }

    sessionStorage.setItem('youji_splash_shown', 'true');

    if (!svgRef.current || !containerRef.current) return;

    const circles = circlesRef.current;
    const textGroup = textRef.current;
    
    if (!textGroup) return;

    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      if (hasCompletedRef.current) return;
      
      const elapsed = currentTime - startTimeRef.current;
      const TOTAL = 1800;

      const DRAW_DURATION = 600;
      const SHRINK_START = 500;
      const SHRINK_DURATION = 400;
      const TEXT_START = 900;
      const TEXT_DURATION = 400;
      const CENTER_START = 1200;
      const CENTER_DURATION = 300;
      const FADE_START = 1500;
      const FADE_DURATION = 300;

      const container = containerRef.current!;
      const computedStyle = getComputedStyle(document.documentElement);
      const textPrimary = computedStyle.getPropertyValue('--text-1').trim() || '#1A1A2E';
      const accent = computedStyle.getPropertyValue('--primary').trim() || '#7C6FFF';
      const bg = computedStyle.getPropertyValue('--bg').trim() || '#F7F7FA';
      container.style.background = bg;

      if (chineseTextRef.current) chineseTextRef.current.setAttribute('fill', textPrimary);
      if (englishTextRef.current) englishTextRef.current.setAttribute('fill', accent);

      if (elapsed < DRAW_DURATION) {
        CIRCLE_CONFIGS.forEach((_, i) => {
          const circle = circles[i];
          if (!circle) return;

          const circumference = CIRCUMFERENCES[i];
          const delay = i * 80;
          const duration = 350;
          const t = Math.max(0, Math.min((elapsed - delay) / duration, 1));
          const eased = easeOutExpo(t);
          
          circle.style.strokeDasharray = `${circumference}`;
          circle.style.strokeDashoffset = `${circumference * (1 - eased)}`;
        });

        const fillCircle = circles[0];
        if (fillCircle) {
          const t = Math.max(0, Math.min((elapsed - 100) / 300, 1));
          fillCircle.style.opacity = easeOutExpo(t).toString();
        }
      }

      if (elapsed >= SHRINK_START && elapsed < SHRINK_START + SHRINK_DURATION) {
        const t = easeInOutCubic((elapsed - SHRINK_START) / SHRINK_DURATION);
        const scale = 1 - t * 0.3;
        const translateX = t * -10;
        container.style.transform = `scale(${scale}) translateX(${translateX}%)`;

        CIRCLE_CONFIGS.forEach((_, i) => {
          const circle = circles[i];
          if (circle) {
            circle.style.strokeDashoffset = '0';
          }
        });
      }

      if (elapsed >= TEXT_START && elapsed < TEXT_START + TEXT_DURATION) {
        const t = easeOutExpo((elapsed - TEXT_START) / TEXT_DURATION);
        textGroup.style.opacity = t.toString();
        textGroup.style.transform = `translateY(${(1 - t) * 15}px) scale(${0.95 + t * 0.05})`;
      }

      if (elapsed >= CENTER_START && elapsed < CENTER_START + CENTER_DURATION) {
        const t = easeInOutCubic((elapsed - CENTER_START) / CENTER_DURATION);
        const scale = 0.7 + t * 0.3;
        const translateX = -10 * (1 - t);
        container.style.transform = `scale(${scale}) translateX(${translateX}%)`;
      }

      if (elapsed >= FADE_START && elapsed < FADE_START + FADE_DURATION) {
        const t = easeInOutCubic((elapsed - FADE_START) / FADE_DURATION);
        containerRef.current!.style.opacity = (1 - t).toString();
      }

      if (elapsed >= FADE_START + FADE_DURATION && !hasCompletedRef.current) {
        hasCompletedRef.current = true;
        onCompleteRef.current();
        return;
      }

      if (elapsed < TOTAL) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [easeOutExpo, easeInOutCubic]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 flex items-center justify-center overflow-hidden will-change-transform"
      style={{ zIndex: 'var(--z-splash)' }}
      aria-hidden
    >
      <div className="relative w-full max-w-2xl px-6">
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 600 320"
          width="100%"
          height="auto"
          className="select-none"
          style={{ willChange: 'transform' }}
        >
          <defs>
            <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#e8941e" />
              <stop offset="100%" stopColor="#c9553e" />
            </linearGradient>
          </defs>

          <g>
            <circle
              ref={el => { if (el) circlesRef.current[0] = el; }}
              cx="120"
              cy="160"
              r="16"
              fill="url(#logoGrad)"
              opacity="0"
              style={{
                willChange: 'stroke-dashoffset, opacity',
              }}
            />
          </g>
          
          <g>
            <circle
              ref={el => { if (el) circlesRef.current[1] = el; }}
              cx="120"
              cy="160"
              r="40"
              fill="none"
              stroke="url(#logoGrad)"
              strokeWidth="5"
              opacity="0.55"
              strokeLinecap="round"
              style={{
                transformOrigin: '120px 160px',
                transform: 'rotate(-90deg)',
                willChange: 'stroke-dashoffset',
              }}
            />
          </g>

          <g>
            <circle
              ref={el => { if (el) circlesRef.current[2] = el; }}
              cx="120"
              cy="160"
              r="68"
              fill="none"
              stroke="url(#logoGrad)"
              strokeWidth="4"
              opacity="0.3"
              strokeLinecap="round"
              style={{
                transformOrigin: '120px 160px',
                transform: 'rotate(-90deg)',
                willChange: 'stroke-dashoffset',
              }}
            />
          </g>

          <g>
            <circle
              ref={el => { if (el) circlesRef.current[3] = el; }}
              cx="120"
              cy="160"
              r="100"
              fill="none"
              stroke="url(#logoGrad)"
              strokeWidth="3"
              opacity="0.14"
              strokeLinecap="round"
              style={{
                transformOrigin: '120px 160px',
                transform: 'rotate(-90deg)',
                willChange: 'stroke-dashoffset',
              }}
            />
          </g>

          <g
            ref={textRef}
            style={{
              opacity: 0,
              transform: 'translateY(15px) scale(0.95)',
              willChange: 'transform, opacity',
            }}
          >
            <text
            ref={chineseTextRef}
            x="270"
            y="180"
            fontFamily="'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif"
            fontSize="96"
            fontWeight="800"
            letterSpacing="8"
          >
            有迹
          </text>
          <text
            ref={englishTextRef}
            x="270"
            y="232"
            fontFamily="'Inter','Helvetica Neue',sans-serif"
            fontSize="28"
            fontWeight="500"
            letterSpacing="12"
          >
            YOUTRACE
          </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

export default SplashScreen;
