interface PerformanceMetric {
  name: string;
  value: number;
  rating: string;
}

const metricsBuffer: PerformanceMetric[] = [];
const FLUSH_INTERVAL = 60 * 1000;
const MAX_BUFFER_SIZE = 50;

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

function bufferMetric(metric: PerformanceMetric) {
  metricsBuffer.push(metric);
  if (metricsBuffer.length >= MAX_BUFFER_SIZE) {
    flushMetrics();
  }
}

async function flushMetrics() {
  if (metricsBuffer.length === 0) return;
  const batch = metricsBuffer.splice(0);
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({ metrics: batch })], { type: 'application/json' });
      navigator.sendBeacon('/api/monitoring/metrics', blob);
    }
  } catch {
    // monitoring endpoint not available, discard
  }
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
        bufferMetric(metric);
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

  setInterval(flushMetrics, FLUSH_INTERVAL);

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushMetrics();
    }
  });
}

function reportNavigationTiming() {
  setTimeout(() => {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (!nav) return;

    const metrics: PerformanceMetric[] = [
      { name: 'TTFB', value: nav.responseStart - nav.requestStart, rating: getRating('TTFB', nav.responseStart - nav.requestStart) },
      { name: 'DOM_READY', value: nav.domInteractive - nav.responseEnd, rating: 'good' },
      { name: 'PAGE_LOAD', value: nav.loadEventEnd - nav.startTime, rating: nav.loadEventEnd - nav.startTime < 3000 ? 'good' : nav.loadEventEnd - nav.startTime < 6000 ? 'needs-improvement' : 'poor' },
    ];

    for (const m of metrics) {
      bufferMetric(m);
    }
  }, 0);
}

export function initErrorMonitoring() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    try {
      if (navigator.sendBeacon) {
        const payload = JSON.stringify({
          type: 'error',
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          timestamp: Date.now(),
        });
        navigator.sendBeacon('/api/monitoring/errors', new Blob([payload], { type: 'application/json' }));
      }
    } catch {
      // monitoring endpoint not available
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      if (navigator.sendBeacon) {
        const payload = JSON.stringify({
          type: 'unhandled_rejection',
          reason: String(event.reason),
          timestamp: Date.now(),
        });
        navigator.sendBeacon('/api/monitoring/errors', new Blob([payload], { type: 'application/json' }));
      }
    } catch {
      // monitoring endpoint not available
    }
  });
}
