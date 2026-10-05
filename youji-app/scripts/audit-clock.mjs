// Test-process/browser Date fixture only. Never imported by production sources.
// Keep timers, performance.now(), HTTP cookies and database engine timestamps real.
// The browser and Node server share one wall-clock anchor; Date keeps advancing.
export const HABIT_AUDIT_INSTANT = '2026-10-07T04:00:00.000Z';

export function createHabitAuditClock(wallMs = Date.now()) {
  if (!Number.isSafeInteger(wallMs) || wallMs <= 0) throw new Error('Invalid audit clock wall anchor');
  return { kind: 'controlled-test-Date-v1', instant: HABIT_AUDIT_INSTANT, wallMs, timeZone: 'Asia/Shanghai' };
}

// Self-contained because Puppeteer serializes this function into each document.
// Only Date is replaced. This does not create records, alter auth or call app code.
export function installAuditDate(config) {
  if (config?.kind !== 'controlled-test-Date-v1' || config.instant !== '2026-10-07T04:00:00.000Z' || !Number.isSafeInteger(config.wallMs) || config.wallMs <= 0 || config.timeZone !== 'Asia/Shanghai') throw new Error('Invalid explicitly labelled Y5 clock');
  if (globalThis.__youtraceAuditClock) {
    if (JSON.stringify(globalThis.__youtraceAuditClock) !== JSON.stringify(config)) throw new Error('Different audit clock already installed');
    return;
  }
  const NativeDate = globalThis.Date, offset = NativeDate.parse(config.instant) - config.wallMs;
  const AuditDate = new Proxy(NativeDate, {
    apply() { return new NativeDate(NativeDate.now() + offset).toString(); },
    construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [NativeDate.now() + offset], newTarget); },
    get(target, key, receiver) { return key === 'now' ? () => NativeDate.now() + offset : Reflect.get(target, key, receiver); },
  });
  Object.defineProperty(globalThis, '__youtraceAuditClock', { value: Object.freeze({ ...config }), configurable: false });
  globalThis.Date = AuditDate;
}

// Explicit --import preload on the disposable CI API process, never NODE_OPTIONS.
// Merely importing this module in the driver has no effect on the driver's Date.
if (typeof process !== 'undefined' && process.env.YOUTRACE_AUDIT_CLOCK_PRELOAD === 'habit-outcomes-v1') {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.NODE_ENV !== 'test' || !['habits', 'habits-frequency'].includes(process.env.AUDIT_TASK_SET) || !/^file:.*[/\\]youtrace-outcomes-[^/\\]+[/\\]synthetic\.db$/.test(process.env.DATABASE_URL ?? '')) throw new Error('Y5 Date preload is restricted to the disposable hosted-CI test API');
  const config = createHabitAuditClock(Number(process.env.YOUTRACE_AUDIT_CLOCK_WALL_MS));
  if (process.env.YOUTRACE_AUDIT_CLOCK_ISO !== config.instant) throw new Error('Y5 Date preload requires the explicit Wednesday instant');
  installAuditDate(config);
}
