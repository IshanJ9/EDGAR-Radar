import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { describe, expect, test } from 'vitest';
import type { Company } from '../lib/api';
import { SearchBox } from './SearchBox';

const company = (ticker: string, name: string, industry: string | null = null): Company => ({
  cik: `000000${ticker.length}`,
  ticker,
  name,
  displayName: name,
  industry,
  ratings: {},
});

const COMPANIES: Company[] = [
  company('AAPL', 'Apple Inc.', 'Electronic Computers'),
  company('AMAT', 'Applied Materials Inc', 'Special Industry Machinery'),
  company('MSFT', 'Microsoft Corp'),
  company('TSLA', 'Tesla, Inc.'),
];

function CompanyRoute() {
  const { ticker } = useParams();
  return <p>Company page for {ticker}</p>;
}

function renderSearch(companies: Company[] | null = COMPANIES, failed = false) {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<SearchBox companies={companies} failed={failed} />} />
        <Route path="/company/:ticker" element={<CompanyRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  return { input: screen.getByRole('combobox', { name: /search for a company/i }), user: userEvent.setup() };
}

describe('SearchBox', () => {
  test('shows matching companies, best first, with their ticker and industry', async () => {
    const { input, user } = renderSearch();

    await user.type(input, 'app');

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Apple Inc.'),
      expect.stringContaining('Applied Materials Inc'),
    ]);
    expect(options[0]).toHaveTextContent('AAPL');
    expect(options[0]).toHaveTextContent('Electronic Computers');
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  test('Enter opens the first result', async () => {
    const { input, user } = renderSearch();

    await user.type(input, 'app{Enter}');

    expect(screen.getByText('Company page for AAPL')).toBeInTheDocument();
  });

  test('the arrow keys choose a result, and Enter opens it', async () => {
    const { input, user } = renderSearch();

    await user.type(input, 'app{ArrowDown}{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1]!.id);
    await user.keyboard('{Enter}');

    expect(screen.getByText('Company page for AMAT')).toBeInTheDocument();
  });

  test('clicking a result opens it', async () => {
    const { input, user } = renderSearch();

    await user.type(input, 'tesla');
    await user.click(screen.getByRole('option', { name: /tesla/i }));

    expect(screen.getByText('Company page for TSLA')).toBeInTheDocument();
  });

  test('no match explains what is covered and suggests companies that are', async () => {
    const { input, user } = renderSearch();

    await user.type(input, 'toyota');

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/no company matches/i)).toHaveTextContent('toyota');
    expect(screen.getByText(/covers 4 large US companies/i)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /microsoft/i }));
    expect(screen.getByText('Company page for MSFT')).toBeInTheDocument();
  });

  test('Escape clears the search', async () => {
    const { input, user } = renderSearch();

    await user.type(input, 'app{Escape}');

    expect(input).toHaveValue('');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  test('pressing "/" anywhere on the page jumps to the search box', async () => {
    const { input, user } = renderSearch();

    await user.keyboard('/');

    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
  });

  test('while the company list is still loading, it says so', async () => {
    const { input, user } = renderSearch(null);

    await user.type(input, 'app');

    expect(screen.getByText(/loading companies/i)).toBeInTheDocument();
  });

  test('if the company list could not be loaded, it says so instead of "no match"', async () => {
    const { input, user } = renderSearch(null, true);

    await user.type(input, 'app');

    expect(screen.getByText(/search is unavailable right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/no company matches/i)).not.toBeInTheDocument();
  });
});
