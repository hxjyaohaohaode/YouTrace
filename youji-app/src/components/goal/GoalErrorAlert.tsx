import { useEffect, useRef } from 'react';

export function GoalErrorAlert({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { ref.current?.focus(); ref.current?.scrollIntoView({ block: 'nearest' }); });
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return <p ref={ref} tabIndex={-1} role="alert" className="rounded-xl border border-[var(--danger)]/30 bg-[var(--surface)] p-3 text-sm leading-6 text-[var(--danger)]">{text}</p>;
}
