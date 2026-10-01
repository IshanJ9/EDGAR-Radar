import { describe, expect, test } from 'vitest';
import { searchCompanies, type Searchable } from './search';

const company = (ticker: string, name: string, displayName = name): Searchable => ({ ticker, name, displayName });

const COMPANIES: Searchable[] = [
  company('AMAT', 'APPLIED MATERIALS INC /DE', 'Applied Materials Inc'),
  company('AAPL', 'Apple Inc.'),
  company('TSLA', 'Tesla, Inc.'),
  company('KO', 'COCA COLA CO', 'Coca-Cola Co'),
  company('MCD', 'MCDONALDS CORP', "McDonald's Corp"),
  company('SCHW', 'SCHWAB CHARLES CORP', 'Charles Schwab Corp'),
  company('FDX', 'FEDEX CORP', 'FedEx Corp'),
  company('F', 'FORD MOTOR CO', 'Ford Motor Co'),
  company('JPM', 'JPMORGAN CHASE & CO', 'JPMorgan Chase & Co'),
];

const tickers = (query: string, limit?: number) => searchCompanies(COMPANIES, query, limit).map((c) => c.ticker);

describe('searchCompanies', () => {
  test('an empty or blank query matches nothing', () => {
    expect(tickers('')).toEqual([]);
    expect(tickers('   ')).toEqual([]);
  });

  test('a ticker matches regardless of case', () => {
    expect(tickers('tsla')).toEqual(['TSLA']);
  });

  test('an exact ticker ranks above names that merely start with the query', () => {
    expect(tickers('f')[0]).toBe('F');
    expect(tickers('f')).toEqual(expect.arrayContaining(['FDX']));
  });

  test('names starting with the query come first, shorter names before longer ones', () => {
    expect(tickers('app')).toEqual(['AAPL', 'AMAT']);
  });

  test('punctuation and spacing do not matter', () => {
    expect(tickers('coca cola')).toEqual(['KO']);
    expect(tickers('cocacola')).toEqual(['KO']);
    expect(tickers('mcdonalds')).toEqual(['MCD']);
  });

  test('matches a word inside the name, not only its start', () => {
    expect(tickers('schwab')).toEqual(['SCHW']);
    expect(tickers('chase')).toEqual(['JPM']);
  });

  test('a query that matches nothing returns nothing', () => {
    expect(tickers('toyota')).toEqual([]);
  });

  test('returns at most `limit` results', () => {
    expect(tickers('c', 2)).toHaveLength(2);
  });
});
