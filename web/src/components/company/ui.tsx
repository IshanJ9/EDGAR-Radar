import type { ReactNode } from 'react';
import type { Tone } from '../../lib/explain';

/** Verdict badges: a soft fill with dark text, for legible contrast. Gauges use colors.ts. */
const TONE_BADGE: Record<Tone, string> = {
  good: 'bg-[#e4f3e4] text-[#0b5a1e]',
  neutral: 'bg-brand-soft text-link',
  warning: 'bg-[#fef0c7] text-[#7a3e00]',
  serious: 'bg-[#fde8dd] text-[#8a3412]',
  critical: 'bg-[#fde4e4] text-[#8f1d1d]',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${TONE_BADGE[tone]}`}>{children}</span>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-line bg-surface p-6 sm:p-7 ${className}`}>{children}</div>;
}

/** A section still waiting for its data. */
export function Loading({ what }: { what: string }) {
  return (
    <p className="m-0 animate-pulse text-base text-muted" role="status">
      Loading {what}…
    </p>
  );
}

/** A section whose data failed: the rest of the page is unaffected. */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3" role="alert">
      <p className="m-0 text-base text-body">We couldn't load {what}. The rest of the page is fine.</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-[10px] border border-line bg-surface px-4 text-[15px] font-medium text-ink hover:border-brand"
      >
        Try again
      </button>
    </div>
  );
}
