/**
 * Post-Phase 7 hardening, step 3 (F1a) - the read-only endpoints the frontend
 * needs, tested through the real Express app with Supertest.
 *
 * The data layer is stubbed (database, scoring, SEC), so these check routing,
 * validation, response shape and one rule above all: no endpoint here may
 * fetch from SEC. A visitor's click must never spend the SEC rate budget.
 */
jest.mock('../bullBoard', () => ({ bullBoardRouter: jest.requireActual('express').Router() }));
jest.mock('../queues', () => ({}));
jest.mock('../db', () => ({ pool: { query: jest.fn() }, readDb: { query: jest.fn() } }));
jest.mock('../universe', () => ({
  loadUniverse: () => [
    { cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.' },
    { cik: '0000019617', ticker: 'JPM', name: 'JPMORGAN CHASE & CO' },
  ],
}));
jest.mock('../scoring', () => ({
  computeAltmanZDoublePrime: jest.fn(),
  computePiotroskiFScore: jest.fn(),
  computeBeneishMScore: jest.fn(),
}));
jest.mock('../repositories/companyRepository', () => ({
  getCompanyByCik: jest.fn(),
  getFactsByCik: jest.fn(),
  getIndustries: jest.fn(),
  upsertCompanyFacts: jest.fn(),
}));
jest.mock('../repositories/statsRepository', () => ({
  getPipelineStats: jest.fn(),
  getRecentFilings: jest.fn(),
}));
jest.mock('../repositories/riskFactorDiffRepository', () => ({
  getLatestRiskFactorDiff: jest.fn(),
  hasRiskFactorDiff: jest.fn(),
  upsertRiskFactorDiff: jest.fn(),
}));
jest.mock('../riskFactorDiff', () => ({ diffRiskFactorFilings: jest.fn() }));
jest.mock('../sec', () => ({
  ...jest.requireActual('../sec'),
  fetchCompanyFacts: jest.fn(),
  fetchSubmissions: jest.fn(),
}));

import request from 'supertest';
import { app } from '../app';
import * as scoring from '../scoring';
import * as companyRepository from '../repositories/companyRepository';
import * as statsRepository from '../repositories/statsRepository';
import * as sec from '../sec';
import * as riskFactorDiffRepository from '../repositories/riskFactorDiffRepository';
import { diffRiskFactorFilings } from '../riskFactorDiff';

const APPLE_ALTMAN = {
  status: 'ok',
  value: 1.685,
  classification: 'grey-zone',
  inputs: { fiscalYear: 2025, workingCapital: -23405000000 },
} as const;
const INSUFFICIENT = { status: 'insufficient-history', reason: 'Need 2 fiscal years of data; missing for: shares.' } as const;

function stubScores() {
  jest.mocked(scoring.computeAltmanZDoublePrime).mockImplementation(async (cik) =>
    cik === '0000320193' ? APPLE_ALTMAN : INSUFFICIENT,
  );
  jest.mocked(scoring.computePiotroskiFScore).mockResolvedValue(INSUFFICIENT as never);
  jest.mocked(scoring.computeBeneishMScore).mockResolvedValue(INSUFFICIENT as never);
}

function expectNoSecRequests() {
  expect(companyRepository.upsertCompanyFacts).not.toHaveBeenCalled();
  expect(sec.fetchCompanyFacts).not.toHaveBeenCalled();
  expect(sec.fetchSubmissions).not.toHaveBeenCalled();
}

// jest.setup.ts blocks every real network connection except loopback, which
// Supertest uses to reach the app: a request to SEC (or anywhere else) still
// fails the test.
beforeEach(() => {
  jest.clearAllMocks();
  stubScores();
});

describe('GET /companies', () => {
  test('lists every monitored company with its industry and a rating summary, without the score inputs', async () => {
    jest.mocked(companyRepository.getIndustries).mockResolvedValue(new Map([['0000320193', 'Electronic Computers']]));

    const res = await request(app).get('/companies').expect(200);

    expect(res.body.count).toBe(2);
    expect(res.body.companies[0]).toEqual({
      cik: '0000320193',
      ticker: 'AAPL',
      name: 'Apple Inc.',
      industry: 'Electronic Computers',
      ratings: {
        altmanZ: { status: 'ok', value: 1.685, classification: 'grey-zone' },
        piotroskiF: { status: 'insufficient-history' },
        beneishM: { status: 'insufficient-history' },
      },
    });
    expect(res.body.companies[1].ratings.altmanZ).toEqual({ status: 'insufficient-history' });
    expect(res.body.companies[1].industry).toBeNull(); // not seen by the poller yet
    expectNoSecRequests();
  });
});

// Post-Phase 7 hardening, step 3 (F1c): diffs are computed when a 10-K
// arrives, so this endpoint only reads. Before, a click on a company with no
// stored diff downloaded two 10-Ks from SEC and embedded both - 10-15 s of
// CPU and 3 SEC requests, from any visitor.
describe('GET /companies/:cik/risk-factor-diff', () => {
  test('returns the stored diff', async () => {
    const stored = { cik: '0000320193', currentAccn: 'a-2', priorAccn: 'a-1', summary: {}, chunks: [] };
    jest.mocked(riskFactorDiffRepository.getLatestRiskFactorDiff).mockResolvedValue(stored as never);

    const res = await request(app).get('/companies/320193/risk-factor-diff').expect(200);

    expect(res.body).toEqual(stored);
  });

  test('no stored diff is a 404 - never an SEC download or an embedding', async () => {
    jest.mocked(riskFactorDiffRepository.getLatestRiskFactorDiff).mockResolvedValue(null);

    const res = await request(app).get('/companies/320193/risk-factor-diff').expect(404);

    expect(res.body.error).toMatch(/no risk-factor comparison/i);
    expect(diffRiskFactorFilings).not.toHaveBeenCalled();
    expect(riskFactorDiffRepository.upsertRiskFactorDiff).not.toHaveBeenCalled();
    expectNoSecRequests();
  });
});

describe('GET /companies/:cik/scores', () => {
  test('returns all three scores, with their inputs, for a stored company', async () => {
    jest.mocked(companyRepository.getCompanyByCik).mockResolvedValue({ cik: '0000320193', entity_name: 'Apple Inc.' } as never);

    const res = await request(app).get('/companies/320193/scores').expect(200);

    expect(res.body).toEqual({
      cik: '0000320193',
      scores: { altmanZ: APPLE_ALTMAN, piotroskiF: INSUFFICIENT, beneishM: INSUFFICIENT },
    });
  });

  test('a company that is not stored is a 404 - never a fetch from SEC', async () => {
    jest.mocked(companyRepository.getCompanyByCik).mockResolvedValue(null);

    await request(app).get('/companies/0000000001/scores').expect(404);

    expect(scoring.computeAltmanZDoublePrime).not.toHaveBeenCalled();
    expectNoSecRequests();
  });

  test('rejects a CIK that is not 1-10 digits', async () => {
    await request(app).get('/companies/apple/scores').expect(400);
  });
});

describe('GET /stats', () => {
  test('reports the pipeline state, with the number of companies monitored', async () => {
    const lastPoll = { finishedAt: '2026-10-01T10:01:38.000Z', companiesChecked: 196, newFilingsFound: 3 };
    const lastReconciliation = { finishedAt: '2026-10-01T02:02:10.000Z', companiesChecked: 196, discrepanciesFound: 0 };
    jest.mocked(statsRepository.getPipelineStats).mockResolvedValue({
      companiesStored: 196,
      factsStored: 6035,
      filingsDiscoveredLast24h: 662,
      lastPoll,
      lastReconciliation,
    });

    const res = await request(app).get('/stats').expect(200);

    expect(res.body).toEqual({
      companiesMonitored: 2,
      companiesStored: 196,
      factsStored: 6035,
      filingsDiscoveredLast24h: 662,
      lastPoll,
      lastReconciliation,
    });
  });
});

describe('GET /filings/recent', () => {
  const rows = [
    { accessionNumber: '0000019617-26-000009', cik: '0000019617', form: '424B2', filingDate: '2026-10-01', discoveredAt: '2026-10-01T10:30:00.000Z' },
    { accessionNumber: '0000320193-26-000100', cik: '0000320193', form: '4', filingDate: '2026-10-01', discoveredAt: '2026-10-01T10:00:00.000Z' },
    { accessionNumber: '0000320193-26-000099', cik: '0000320193', form: '8-K', filingDate: '2026-10-01', discoveredAt: '2026-10-01T09:30:00.000Z' },
  ];

  beforeEach(() => {
    jest.mocked(statsRepository.getRecentFilings).mockResolvedValue(rows);
  });

  test('lists the last 24 hours by default, newest first, with names and plain categories', async () => {
    const res = await request(app).get('/filings/recent').expect(200);

    expect(statsRepository.getRecentFilings).toHaveBeenCalledWith(24, expect.anything());
    expect(res.body.windowHours).toBe(24);
    expect(res.body.total).toBe(3);
    expect(res.body.countsByCategory).toEqual({ offering: 1, 'insider-trade': 1, 'major-event': 1 });
    expect(res.body.filings[0]).toEqual({ ...rows[0], ticker: 'JPM', name: 'JPMORGAN CHASE & CO', category: 'offering' });
    expect(res.body.filings.map((f: { form: string }) => f.form)).toEqual(['424B2', '4', '8-K']);
  });

  test('`exclude` drops categories from the list but not from the counts', async () => {
    const res = await request(app).get('/filings/recent?exclude=offering').expect(200);

    expect(res.body.filings.map((f: { form: string }) => f.form)).toEqual(['4', '8-K']);
    expect(res.body.total).toBe(3);
    expect(res.body.countsByCategory.offering).toBe(1);
  });

  test('`hours` is a whole number from 1 to 168', async () => {
    await request(app).get('/filings/recent?hours=72').expect(200);
    expect(statsRepository.getRecentFilings).toHaveBeenLastCalledWith(72, expect.anything());

    for (const bad of ['0', '169', 'abc', '1.5']) {
      await request(app).get(`/filings/recent?hours=${bad}`).expect(400);
    }
  });

  test('returns at most 200 filings, the newest', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...rows[1], accessionNumber: `0000320193-26-${String(i).padStart(6, '0')}` }));
    jest.mocked(statsRepository.getRecentFilings).mockResolvedValue(many);

    const res = await request(app).get('/filings/recent').expect(200);

    expect(res.body.filings).toHaveLength(200);
    expect(res.body.filings[0].accessionNumber).toBe('0000320193-26-000000');
    expect(res.body.total).toBe(250);
  });
});
