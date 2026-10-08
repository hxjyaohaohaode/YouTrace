import type { Ref } from 'react';
import originalWordmark from '../../../public/brand/youtrace-wordmark.svg?raw';
/** Canonical artwork is copied byte-for-byte from the user's root originals. */
export function Brand({ variant = 'compact', className = '', animated = false, artworkRef }: { animated?: boolean; artworkRef?: Ref<HTMLSpanElement>; variant?: 'compact' | 'full' | 'mark'; className?: string }) {
  if (variant === 'full' && animated) return <span ref={artworkRef} className={`brand-wordmark brand-animated ${className}`} role="img" aria-label="有迹 YouTrace" dangerouslySetInnerHTML={{ __html: originalWordmark }} />;
  if (variant === 'full') return <img src="/brand/youtrace-wordmark.svg" alt="有迹 YouTrace" className={`brand-wordmark ${className}`} width="1160" height="320" />;
  return <span className={`brand-lockup ${className}`}><img src="/brand/youtrace-mark.svg" alt={variant === 'mark' ? '有迹 YouTrace' : ''} width="1024" height="1024" />{variant === 'compact' && <span><strong>有迹</strong><small>YOUTRACE</small></span>}</span>;
}
