import { useId, type ReactNode } from 'react';
import type { AltmanInputs, BeneishInputs, CompanyScores, PiotroskiInputs, ScoreOutcome } from '../../lib/api';
import {
  ALTMAN_GAUGE,
  BENEISH_GAUGE,
  altmanBand,
  altmanReasons,
  beneishBand,
  beneishReasons,
  derivedNotes,
  formatScore,
  isFinancialCompany,
  piotroskiBand,
  piotroskiChecks,
  unscoredReason,
  type Tone,
} from '../../lib/explain';
import type { DataState } from '../../lib/useData';
import { STATUS_COLOR } from './colors';
import { Badge, LoadFailed, Loading } from './ui';

interface Props {
  scores: DataState<CompanyScores>;
  industry: string | null;
}

/** The three scores, each as a card: a plain-English verdict, the number, a gauge and the reasons. */
export function HealthCheck({ scores, industry }: Props) {
  return (
    <section aria-labelledby="health-check" className="flex flex-col gap-[18px]">
      <h2 id="health-check" className="m-0 font-display text-[26px] font-semibold sm:text-[28px]">
        Financial health check
      </h2>
      {scores.failed ? (
        <LoadFailed what="the health check" onRetry={scores.retry} />
      ) : !scores.data ? (
        <Loading what="the health check" />
      ) : (
        <Cards scores={scores.data.scores} industry={industry} />
      )}
    </section>
  );
}

function Cards({ scores, industry }: { scores: CompanyScores['scores']; industry: string | null }) {
  const { altmanZ, piotroskiF, beneishM } = scores;
  const noneScored = [altmanZ, piotroskiF, beneishM].every((s) => s.status !== 'ok');
  if (noneScored && isFinancialCompany(industry)) return <FinancialsNotice />;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        <AltmanCard outcome={altmanZ} />
        <PiotroskiCard outcome={piotroskiF} />
        <BeneishCard outcome={beneishM} />
      </div>
      <p className="m-0 text-sm text-muted">
        Scores use the latest annual figures. They're prompts to look closer, not verdicts - and not investment advice.
      </p>
    </>
  );
}

function ScoreCard({ title, verdict, children }: { title: string; verdict: { label: string; tone: Tone }; children: ReactNode }) {
  const id = useId();
  return (
    <article aria-labelledby={id} className="flex flex-col gap-[18px] rounded-card border border-line bg-surface p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} className="m-0 text-[17px] font-semibold text-body">
          {title}
        </h3>
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
      </div>
      {children}
    </article>
  );
}

function Value({ children, name }: { children: ReactNode; name: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="font-display text-5xl font-bold tracking-[-0.02em]">{children}</span>
      <span className="text-sm text-muted">{name}</span>
    </div>
  );
}

function Reasons({ heading = 'Why', items, notes = [] }: { heading?: string; items: string[]; notes?: string[] }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4 text-[15px] leading-normal">
      <span className="font-semibold">{heading}</span>
      {items.map((item) => (
        <span key={item} className="text-body">
          {item}
        </span>
      ))}
      {notes.map((note) => (
        <span key={note} className="text-sm text-muted">
          {note}
        </span>
      ))}
    </div>
  );
}

/** A coloured zone bar with a marker at `position` (0-1); the zones are labelled underneath. */
function Gauge({ zones, position, labels }: { zones: { width: number; color: string }[]; position: number; labels: string[] }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="relative">
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
          {zones.map((z) => (
            <span key={z.color} style={{ width: `${z.width * 100}%`, background: z.color }} />
          ))}
        </div>
        <span className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-sm bg-ink ring-2 ring-surface" style={{ left: `${position * 100}%` }} />
      </div>
      <div className="flex justify-between text-[13px] text-muted">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function Unscored({ title, reason }: { title: string; reason: string }) {
  return (
    <ScoreCard title={title} verdict={{ label: 'Not available', tone: 'neutral' }}>
      <p className="m-0 text-[15px] leading-relaxed text-body">{unscoredReason(reason)}</p>
      <p className="m-0 text-sm text-muted">It appears automatically if the missing figures are filed.</p>
    </ScoreCard>
  );
}

function AltmanCard({ outcome }: { outcome: ScoreOutcome<AltmanInputs> }) {
  const title = 'Bankruptcy risk';
  if (outcome.status !== 'ok') return <Unscored title={title} reason={outcome.reason} />;
  const band = altmanBand(outcome.classification, outcome.value);
  const span = ALTMAN_GAUGE.max - ALTMAN_GAUGE.min;
  return (
    <ScoreCard title={title} verdict={band}>
      <Value name="Altman Z″ score">{formatScore(outcome.value)}</Value>
      <Gauge
        position={band.position}
        zones={[
          { width: (ALTMAN_GAUGE.cautionFrom - ALTMAN_GAUGE.min) / span, color: STATUS_COLOR.critical },
          { width: (ALTMAN_GAUGE.safeFrom - ALTMAN_GAUGE.cautionFrom) / span, color: STATUS_COLOR.warning },
          { width: (ALTMAN_GAUGE.max - ALTMAN_GAUGE.safeFrom) / span, color: STATUS_COLOR.good },
        ]}
        labels={['High risk', 'Caution', 'Safe']}
      />
      <Reasons items={altmanReasons(outcome.inputs)} notes={derivedNotes([], outcome.inputs.liabilitiesDerived)} />
    </ScoreCard>
  );
}

function PiotroskiCard({ outcome }: { outcome: ScoreOutcome<PiotroskiInputs> }) {
  const title = 'Financial strength';
  if (outcome.status !== 'ok') return <Unscored title={title} reason={outcome.reason} />;
  const checks = piotroskiChecks(outcome.inputs.signals);
  return (
    <ScoreCard title={title} verdict={piotroskiBand(outcome.classification)}>
      <Value name="Piotroski F-Score">
        {outcome.value}
        <span className="text-[28px] text-faint">/9</span>
      </Value>
      <div className="grid grid-cols-9 gap-1" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={`h-3 rounded-[3px] ${i < outcome.value ? 'bg-[#2a78d6]' : 'bg-line'}`} />
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-line-soft pt-4 text-[15px]">
        <span className="font-semibold">
          {outcome.value} of 9 checks passed (fiscal {outcome.inputs.fiscalYearCurrent} vs {outcome.inputs.fiscalYearPrior})
        </span>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {checks.map((c) => (
            <li key={c.label} className={`flex items-center gap-2.5 ${c.passed ? 'text-body' : 'text-faint'}`}>
              {c.passed ? <PassIcon /> : <FailIcon />}
              <span>{c.label}</span>
              <span className="sr-only">{c.passed ? '(passed)' : '(not passed)'}</span>
            </li>
          ))}
        </ul>
        {derivedNotes(outcome.inputs.derived, false).map((note) => (
          <span key={note} className="text-sm text-muted">
            {note}
          </span>
        ))}
      </div>
    </ScoreCard>
  );
}

function BeneishCard({ outcome }: { outcome: ScoreOutcome<BeneishInputs> }) {
  const title = 'Accounting red flags';
  if (outcome.status !== 'ok') return <Unscored title={title} reason={outcome.reason} />;
  const band = beneishBand(outcome.classification, outcome.value);
  const span = BENEISH_GAUGE.max - BENEISH_GAUGE.min;
  const normal = (BENEISH_GAUGE.threshold - BENEISH_GAUGE.min) / span;
  return (
    <ScoreCard title={title} verdict={band}>
      <Value name="Beneish M-Score">{formatScore(outcome.value)}</Value>
      <Gauge
        position={band.position}
        zones={[
          { width: normal, color: STATUS_COLOR.good },
          { width: 1 - normal, color: STATUS_COLOR.serious },
        ]}
        labels={['Normal', `Worth a closer look (above ${formatScore(BENEISH_GAUGE.threshold)})`]}
      />
      <Reasons items={beneishReasons(outcome.inputs.indices)} notes={derivedNotes(outcome.inputs.derived, false)} />
    </ScoreCard>
  );
}

function FinancialsNotice() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 sm:p-8">
      <h3 className="m-0 font-display text-[22px] font-semibold">These scores don't fit banks and insurers</h3>
      <p className="m-0 max-w-[760px] text-base leading-relaxed text-body">
        All three health scores were designed for companies that sell products. They rely on figures like short-term assets and debts, which banks,
        insurers and property trusts don't report in the same way. Rather than show a misleading number, we leave them out.
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0 text-sm text-muted">
        <li className="rounded-[10px] bg-canvas px-3 py-1.5">Bankruptcy risk - not available</li>
        <li className="rounded-[10px] bg-canvas px-3 py-1.5">Financial strength - not available</li>
        <li className="rounded-[10px] bg-canvas px-3 py-1.5">Accounting red flags - not available</li>
      </ul>
    </div>
  );
}

const PassIcon = () => (
  <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="#1d4ed8" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5L20 7" />
  </svg>
);
const FailIcon = () => (
  <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="#98a2b3" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
