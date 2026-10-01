import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnnualValue, CompanyFinancials } from '../../lib/api';
import { derivedNotes, formatMoney } from '../../lib/explain';
import type { DataState } from '../../lib/useData';
import { SERIES_COLOR } from './colors';
import { Card, LoadFailed, Loading } from './ui';

/** Revenue and profit over the years, and what the company owns and owes in its latest year. */
export function Financials({ financials }: { financials: DataState<CompanyFinancials> }) {
  if (financials.failed) {
    return (
      <Card>
        <LoadFailed what="the financial figures" onRetry={financials.retry} />
      </Card>
    );
  }
  if (!financials.data) {
    return (
      <Card>
        <Loading what="the financial figures" />
      </Card>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <RevenueAndProfit revenue={financials.data.revenue} profit={financials.data.netIncome} />
      <OwnsAndOwes financials={financials.data} />
    </div>
  );
}

const valueAt = (series: AnnualValue[], year: number) => series.find((v) => v.fiscalYear === year)?.value;

/** Legend items in the bars' own order (Recharts sorts them alphabetically by default). */
const SERIES_ORDER = ['revenue', 'profit'];

/** Axis labels without a needless ".0": $150B, $1.5T. */
const axisMoney = (value: number) => formatMoney(value).replace('.0', '');

function RevenueAndProfit({ revenue, profit }: { revenue: AnnualValue[]; profit: AnnualValue[] }) {
  const headingId = useId();
  const years = [...new Set([...revenue, ...profit].map((v) => v.fiscalYear))].sort((a, b) => a - b);
  const rows = years.map((year) => ({ year: String(year), revenue: valueAt(revenue, year), profit: valueAt(profit, year) }));

  return (
    <section aria-labelledby={headingId}>
      <Card className="flex h-full flex-col gap-5">
        <h2 id={headingId} className="m-0 font-display text-2xl font-semibold">
          Revenue and profit
        </h2>
        {rows.length === 0 ? (
          <p className="m-0 text-base text-muted">No annual revenue or profit figures are on file for this company yet.</p>
        ) : (
          <>
            {/* The chart is for sighted readers; the table below carries the same numbers for everyone else. */}
            <div className="h-[280px] w-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                {/* Recharts' own keyboard layer is off: the chart is hidden from screen readers, so it must not
                    take keyboard focus either (axe: aria-hidden-focus). The table below is the accessible version. */}
                <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2} barCategoryGap="28%" accessibilityLayer={false}>
                  <CartesianGrid vertical={false} stroke="#eaecf0" />
                  <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: '#d9dee5' }} tick={{ fill: '#475467', fontSize: 13 }} />
                  <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} tick={{ fill: '#475467', fontSize: 12 }} width={64} />
                  <Tooltip
                    cursor={{ fill: '#f3f5f7' }}
                    formatter={(value) => formatMoney(Number(value))}
                    labelFormatter={(label) => `Fiscal ${label}`}
                    itemSorter={(item) => SERIES_ORDER.indexOf(String(item.dataKey))}
                    itemStyle={{ color: '#344054' }}
                    contentStyle={{ borderRadius: 10, borderColor: '#d9dee5', fontSize: 14 }}
                  />
                  <Legend
                    iconType="square"
                    itemSorter={(item) => SERIES_ORDER.indexOf(String(item.dataKey))}
                    // Text stays in text colour; only the swatch carries the series colour.
                    formatter={(value) => <span style={{ color: '#344054' }}>{value}</span>}
                    wrapperStyle={{ fontSize: 14 }}
                  />
                  <Bar dataKey="revenue" name="Revenue" fill={SERIES_COLOR.first} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="profit" name="Profit" fill={SERIES_COLOR.second} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Revenue and profit by fiscal year</caption>
              <thead>
                <tr>
                  <th scope="col">Fiscal year</th>
                  <th scope="col">Revenue</th>
                  <th scope="col">Profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.year}>
                    <th scope="row">{r.year}</th>
                    <td>{r.revenue === undefined ? 'not reported' : formatMoney(r.revenue)}</td>
                    <td>{r.profit === undefined ? 'not reported' : formatMoney(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 text-sm text-muted">Profit is net income - what is left after every cost, interest and tax.</p>
          </>
        )}
      </Card>
    </section>
  );
}

function OwnsAndOwes({ financials }: { financials: CompanyFinancials }) {
  const headingId = useId();
  const year = financials.totalAssets.at(-1)?.fiscalYear;
  const items =
    year === undefined
      ? []
      : [
          { label: 'Everything it owns', value: valueAt(financials.totalAssets, year) },
          { label: 'Everything it owes', value: valueAt(financials.totalLiabilities, year) },
          { label: 'of which long-term debt', value: valueAt(financials.longTermDebt, year) },
          { label: 'Cash from running the business', value: valueAt(financials.operatingCashFlow, year) },
        ].filter((i): i is { label: string; value: number } => i.value !== undefined);
  const largest = Math.max(...items.map((i) => Math.abs(i.value)), 1);

  return (
    <section aria-labelledby={headingId}>
      <Card className="flex h-full flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="m-0 font-display text-2xl font-semibold">
            What it owns and owes
          </h2>
          {year !== undefined && <span className="text-sm text-muted">Fiscal {year}</span>}
        </div>
        {items.length === 0 ? (
          <p className="m-0 text-base text-muted">No balance-sheet figures are on file for this company yet.</p>
        ) : (
          <dl className="m-0 flex flex-col gap-4">
            {items.map((i) => (
              // A valid <dl> group: the label, its value, and the bar as a second, hidden description.
              <div key={i.label} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">
                <dt>{i.label}</dt>
                <dd className="m-0 font-semibold">{formatMoney(i.value)}</dd>
                <dd aria-hidden="true" className="col-span-2 m-0">
                  <span className="block h-3 rounded-r-[4px]" style={{ width: `${(Math.abs(i.value) / largest) * 100}%`, background: SERIES_COLOR.first }} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {derivedNotes([], financials.liabilitiesDerived).map((note) => (
          <p key={note} className="m-0 text-sm text-muted">
            {note}
          </p>
        ))}
      </Card>
    </section>
  );
}
