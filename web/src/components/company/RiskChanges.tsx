import { useId, useState, type KeyboardEvent } from 'react';
import type { DiffChunk, RiskFactorDiff } from '../../lib/api';
import { formatDate } from '../../lib/explain';
import type { DataState } from '../../lib/useData';
import { Card, LoadFailed, Loading } from './ui';

/** How many changes a tab shows before "Show more". */
const PAGE = 5;
/** Paragraphs longer than this are clipped until "Read the full paragraph". */
const CLIP = 320;

type Kind = 'new' | 'removed' | 'modified';
const TABS: { kind: Kind; label: string; empty: string }[] = [
  { kind: 'new', label: 'New', empty: 'No new risk warnings this year.' },
  { kind: 'removed', label: 'Removed', empty: 'No risk warnings were dropped this year.' },
  { kind: 'modified', label: 'Reworded', empty: 'No risk warnings were reworded this year.' },
];

/** What changed between the company's last two annual reports' Risk Factors sections. */
export function RiskChanges({ name, diff }: { name: string; diff: DataState<RiskFactorDiff | null> }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <Card className="flex flex-col gap-6 sm:p-8">
        <h2 id={headingId} className="m-0 font-display text-[26px] font-semibold sm:text-[28px]">
          What changed in {name}'s risk warnings
        </h2>
        {diff.failed ? (
          <LoadFailed what="the risk-warning comparison" onRetry={diff.retry} />
        ) : !diff.loaded ? (
          <Loading what="the risk-warning comparison" />
        ) : diff.data === null ? (
          <NoComparison />
        ) : (
          <Changes diff={diff.data} />
        )}
      </Card>
    </section>
  );
}

/** No stored comparison - a normal state for some companies, so explained rather than shown as an error. */
function NoComparison() {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-base font-semibold">There's no comparison of its risk warnings yet.</p>
      <p className="m-0 max-w-[720px] text-base leading-relaxed text-muted">
        A comparison needs two annual reports whose "Risk Factors" sections we can read. Some companies have only one on file so far; others lay out
        their report in a way we can't yet separate. It appears automatically once a comparison can be made.
      </p>
    </div>
  );
}

function Changes({ diff }: { diff: RiskFactorDiff }) {
  const [tab, setTab] = useState<Kind>('new');
  const tabsId = useId();
  const byKind = (kind: Kind) => diff.chunks.filter((c) => c.status === kind);
  const count: Record<Kind, number> = { new: diff.summary.added, removed: diff.summary.removed, modified: diff.summary.modified };

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.kind === tab);
    const next = event.key === 'ArrowRight' ? (i + 1) % TABS.length : event.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next]!.kind);
    document.getElementById(`${tabsId}-tab-${TABS[next]!.kind}`)?.focus();
  }

  const current = TABS.find((t) => t.kind === tab)!;
  return (
    <>
      <p className="-mt-3 m-0 text-[15px] text-muted">
        Annual report filed {formatDate(diff.currentFilingDate)}, compared with the one filed {formatDate(diff.priorFilingDate)}. {diff.summary.unchanged}{' '}
        passages are unchanged.
      </p>
      <div role="tablist" aria-label="Kind of change" className="flex gap-1 overflow-x-auto border-b border-line" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.kind}
            id={`${tabsId}-tab-${t.kind}`}
            type="button"
            role="tab"
            aria-selected={t.kind === tab}
            aria-controls={`${tabsId}-panel`}
            tabIndex={t.kind === tab ? 0 : -1}
            onClick={() => setTab(t.kind)}
            className={`-mb-px min-h-12 whitespace-nowrap border-b-[3px] px-4 text-base ${t.kind === tab ? 'border-brand font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label} ({count[t.kind]})
          </button>
        ))}
      </div>
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${tab}`}>
        {/* Keyed by tab, so "Show more" starts over on each tab. */}
        <ChunkList key={tab} chunks={byKind(tab)} kind={tab} empty={current.empty} />
      </div>
      <p className="m-0 text-sm text-muted">
        Found by comparing the meaning of each passage, not just its words, so a reworded risk isn't counted as new. Wording can still move a passage
        between lists - read them as prompts, not findings.
      </p>
    </>
  );
}

function ChunkList({ chunks, kind, empty }: { chunks: DiffChunk[]; kind: Kind; empty: string }) {
  const [shown, setShown] = useState(PAGE);
  if (chunks.length === 0) return <p className="m-0 text-base text-muted">{empty}</p>;
  const rest = chunks.length - shown;
  return (
    <div className="flex flex-col gap-3.5">
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
        {chunks.slice(0, shown).map((chunk, i) => (
          <li key={i}>
            <ChunkCard chunk={chunk} kind={kind} />
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE * 4)}
          className="min-h-11 self-start rounded-[10px] border border-line bg-surface px-4 text-[15px] font-medium text-ink hover:border-brand"
        >
          Show {Math.min(rest, PAGE * 4)} more
        </button>
      )}
    </div>
  );
}

const KIND_STYLE: Record<Kind, { box: string; label: string; tag: string }> = {
  new: { box: 'border-[#f3d5ae] bg-[#fffaf3]', label: 'text-[#7a3e00]', tag: 'New this year' },
  removed: { box: 'border-line bg-canvas', label: 'text-muted', tag: 'No longer listed' },
  modified: { box: 'border-line bg-surface', label: 'text-link', tag: 'Reworded' },
};

function ChunkCard({ chunk, kind }: { chunk: DiffChunk; kind: Kind }) {
  const [open, setOpen] = useState(false);
  const style = KIND_STYLE[kind];
  const before = kind === 'modified' ? chunk.matchedText : null;
  const long = chunk.text.length > CLIP || (before?.length ?? 0) > CLIP;
  const clip = (text: string) => (open || text.length <= CLIP ? text : `${text.slice(0, CLIP).trimEnd()}…`);
  return (
    <article className={`flex flex-col gap-2.5 rounded-[14px] border px-5 py-4 ${style.box}`}>
      <span className={`text-[13px] font-semibold uppercase tracking-[0.06em] ${style.label}`}>{style.tag}</span>
      <p className="m-0 text-base leading-relaxed sm:text-[17px]">{clip(chunk.text)}</p>
      {before && (
        <div className="flex flex-col gap-1 border-t border-line-soft pt-2.5">
          <span className="text-[13px] font-semibold text-muted">Last year it read:</span>
          <p className="m-0 text-[15px] leading-relaxed text-muted">{clip(before)}</p>
        </div>
      )}
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="min-h-11 self-start text-[15px] text-link underline hover:text-link-hover"
        >
          {open ? 'Show less' : 'Read the full paragraph'}
        </button>
      )}
    </article>
  );
}
