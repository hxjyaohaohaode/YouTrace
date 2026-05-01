interface PerformanceMetric {
  name: string;
  value: number;
  rating: string;
}

function getRating(name: string, value: number): string {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    FCP: [1800, 3000],
    CLS: [0.1, 0.25],
    FID: [100, 300],
    INP: [200, 500],
    TTFB: [800, 1800],
  };
  const [good, poor] = thresholds[name] || [Infinity, Infinity];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

export function initPerformanceMonitoring() {
  if (typeof window === 'undefined') return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const metric: PerformanceMetric = {
          name: entry.name,
          value: entry.startTime,
          rating: getRating(entry.name, entry.startTime),
        };
        console.debug(`[Perf] ${metric.name}: ${metric.value.toFixed(0)}ms (${metric.rating})`);
      }
    });

    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    observer.observe({ type: 'first-input', buffered: true });
    observer.observe({ type: 'layout-shift', buffered: true });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // PerformanceObserver not supported
  }

  if (document.readyState === 'complete') {
    reportNavigationTiming();
  } else {
    window.addEventListener('load', reportNavigationTiming);
  }
}

function reportNavigationTiming() {
  setTimeout(() => {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (!nav) return;

    const metrics = {
      DNS: nav.domainLookupEnd - nav.domainLookupStart,
      TCP: nav.connectEnd - nav.connectStart,
      TTFB: nav.responseStart - nav.requestStart,
      Download: nav.responseEnd - nav.responseStart,
      DOM: nav.domInteractive - nav.responseEnd,
      Load: nav.loadEventEnd - nav.loadEventStart,
      Total: nav.loadEventEnd - nav.startTime,
    };

    console.debug('[Perf] Navigation:', metrics);
  }, 0);
}

export function initErrorMonitoring() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    console.error('[Error]', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled Promise]', event.reason);
  });
}
