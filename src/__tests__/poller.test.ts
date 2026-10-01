/**
 * Post-Phase 7, step 5 - the poller finds every filing, once.
 *
 * SEC's `filingDate` is a date with no time ("2026-09-28"), which JavaScript
 * reads as midnight UTC. The poller used to keep a filing only if that date
 * was later than its cursor - a full timestamp - so once the cursor passed
 * midnight, every filing made during the day was skipped, by that cycle and
 * every later one. Production ran 86 cycles over 196 companies, including a
 * Monday morning, and found 0 filings.
 *
 * These tests step the poller through simulated time - a cycle every 30
 * minutes, as scripts/poller.ts schedules it - against in-memory stand-ins
 * for SEC's submissions, the queue and the poller's tables, and count what it
 * enqueues. Nothing connects anywhere.
 */
jest.mock('../sec', () => ({ fetchSubmissions: jest.fn() }));
jest.mock('../queues', () => ({ filingDiscoveredQueue: { add: jest.fn() } }));
jest.mock('../repositories/failingCompanyRepository', () => ({
  isQuarantined: jest.fn(async () => false),
  recordFailure: jest.fn(async () => undefined),
}));
jest.mock('../repositories/companyRepository', () => ({
  updateCompanyIndustry: jest.fn(async () => undefined),
}));
jest.mock('../repositories/pollerRepository', () => ({
  getLastCheckedAt: jest.fn(),
  setLastCheckedAt: jest.fn(),
  startPollerRun: jest.fn(async () => 1),
  completePollerRun: jest.fn(async () => undefined),
  failPollerRun: jest.fn(async () => undefined),
  findDiscoveredAccessions: jest.fn(),
  recordDiscoveredFiling: jest.fn(),
}));

import { fetchSubmissions } from '../sec';
import { filingDiscoveredQueue } from '../queues';
import * as pollerRepository from '../repositories/pollerRepository';
import { updateCompanyIndustry } from '../repositories/companyRepository';
import { runPollCycle } from '../poller';

const APPLE = { cik: '0000320193', ticker: 'AAPL', name: 'Apple Inc.' };
const MSFT = { cik: '0000789019', ticker: 'MSFT', name: 'Microsoft Corp' };
const MINUTE = 60_000;

interface Filing {
  accn: string;
  date: string;
  form: string;
}

/** In-memory SEC submissions, poller cursor and discovered-filings table, on a fake clock. */
function world(startIso: string) {
  jest.setSystemTime(new Date(startIso));
  let cursor: Date | undefined;
  const discovered = new Set<string>();
  const filings = new Map<string, Filing[]>();
  const enqueued: string[] = [];
  const failingCiks = new Set<string>();
  let queueDown = false;

  (fetchSubmissions as jest.Mock).mockImplementation(async (cik: string) => {
    if (failingCiks.has(cik)) throw new Error('Request failed with status 503.');
    const list = filings.get(cik) ?? [];
    return {
      sic: cik === APPLE.cik ? '3571' : '6021',
      sicDescription: cik === APPLE.cik ? 'Electronic Computers' : 'National Commercial Banks',
      filings: {
        recent: {
          accessionNumber: list.map((f) => f.accn),
          filingDate: list.map((f) => f.date),
          form: list.map((f) => f.form),
          primaryDocument: list.map((f) => `${f.accn}.htm`),
        },
      },
    };
  });
  (filingDiscoveredQueue.add as jest.Mock).mockImplementation(async (_name: string, data: { accessionNumber: string }) => {
    if (queueDown) throw new Error('Redis connection lost');
    enqueued.push(data.accessionNumber);
  });

  const repo = jest.mocked(pollerRepository);
  repo.getLastCheckedAt.mockImplementation(async () => cursor ?? new Date(Date.now() - 24 * 60 * MINUTE));
  repo.setLastCheckedAt.mockImplementation(async (t: Date) => void (cursor = t));
  repo.findDiscoveredAccessions.mockImplementation(async (accns: string[]) => new Set(accns.filter((a) => discovered.has(a))));
  repo.recordDiscoveredFiling.mockImplementation(async (filing: { accessionNumber: string }) => {
    discovered.add(filing.accessionNumber);
  });

  return {
    enqueued,
    /** SEC's list is newest first, so a new filing goes on the front. */
    file: (cik: string, filing: Filing) => filings.set(cik, [filing, ...(filings.get(cik) ?? [])]),
    failChecksFor: (cik: string, failing: boolean) => (failing ? failingCiks.add(cik) : failingCiks.delete(cik)),
    setQueueDown: (down: boolean) => (queueDown = down),
    setClock: (iso: string) => jest.setSystemTime(new Date(iso)),
    advance: (minutes: number) => jest.setSystemTime(Date.now() + minutes * MINUTE),
    cycle: () => runPollCycle([APPLE, MSFT]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('a filing made during the day is found by the next cycle - the production bug', async () => {
  const w = world('2026-09-28T13:30:00Z');
  await w.cycle(); // cursor is now 13:30 on the 28th

  w.file(APPLE.cik, { accn: '0000320193-26-000100', date: '2026-09-28', form: '4' });
  w.advance(30);
  const result = await w.cycle();

  expect(w.enqueued).toEqual(['0000320193-26-000100']);
  expect(result.newFilingsFound).toBe(1);
});

test('a filing is enqueued once, not again by every later cycle that still sees it', async () => {
  const w = world('2026-09-28T13:30:00Z');
  await w.cycle();
  w.file(APPLE.cik, { accn: '0000320193-26-000100', date: '2026-09-28', form: '10-Q' });

  let found = 0;
  for (let i = 0; i < 48; i++) {
    // a full day of cycles, across midnight
    w.advance(30);
    found += (await w.cycle()).newFilingsFound;
  }

  expect(w.enqueued).toEqual(['0000320193-26-000100']);
  expect(found).toBe(1);
});

test('an after-hours filing, dated the next business day, is found once', async () => {
  const w = world('2026-09-25T22:00:00Z'); // Friday, 18:00 New York
  await w.cycle();

  w.file(MSFT.cik, { accn: '0000789019-26-000200', date: '2026-09-28', form: '8-K' });
  for (let i = 0; i < 6; i++) {
    w.advance(30);
    await w.cycle();
  }

  expect(w.enqueued).toEqual(['0000789019-26-000200']);
});

test('a filing that reaches SEC\'s list late, after the cursor has passed midnight, is still found', async () => {
  const w = world('2026-09-28T23:30:00Z');
  await w.cycle();
  w.setClock('2026-09-29T00:30:00Z'); // cursor is now into the 29th (UTC)
  await w.cycle();

  // Dated the 28th (New York), appearing in SEC's JSON only now.
  w.file(APPLE.cik, { accn: '0000320193-26-000101', date: '2026-09-28', form: '4' });
  w.advance(30);
  await w.cycle();

  expect(w.enqueued).toEqual(['0000320193-26-000101']);
});

test('filings from before the lookback window are never treated as new', async () => {
  const w = world('2026-09-28T14:00:00Z');
  w.file(APPLE.cik, { accn: '0000320193-26-000001', date: '2026-01-30', form: '10-Q' });
  w.file(APPLE.cik, { accn: '0000320193-26-000050', date: '2026-08-01', form: '10-Q' });

  await w.cycle();
  w.advance(30);
  await w.cycle();

  expect(w.enqueued).toEqual([]);
});

test('if enqueueing fails, the filing is not marked as seen and the next cycle enqueues it', async () => {
  const w = world('2026-09-28T13:30:00Z');
  await w.cycle();
  w.file(APPLE.cik, { accn: '0000320193-26-000100', date: '2026-09-28', form: '4' });

  w.setQueueDown(true);
  w.advance(30);
  await expect(w.cycle()).rejects.toThrow('Redis connection lost');

  w.setQueueDown(false);
  w.advance(30);
  await w.cycle();

  expect(w.enqueued).toEqual(['0000320193-26-000100']);
});

test('a failed company check holds the cursor, and the re-check does not enqueue the others twice', async () => {
  const w = world('2026-09-28T13:30:00Z');
  await w.cycle();
  w.file(APPLE.cik, { accn: '0000320193-26-000100', date: '2026-09-28', form: '4' });
  w.file(MSFT.cik, { accn: '0000789019-26-000200', date: '2026-09-28', form: '4' });

  w.failChecksFor(MSFT.cik, true);
  w.advance(30);
  await w.cycle();
  expect(w.enqueued).toEqual(['0000320193-26-000100']);
  expect(pollerRepository.setLastCheckedAt).toHaveBeenCalledTimes(1); // only the first cycle's

  w.failChecksFor(MSFT.cik, false);
  w.advance(30);
  await w.cycle();

  expect(w.enqueued).toEqual(['0000320193-26-000100', '0000789019-26-000200']);
});

// F1b: the industry comes from the submissions document the poller already
// downloads for every company every cycle - no extra SEC request.
test('records each company’s industry from the submissions it already fetched', async () => {
  const w = world('2026-09-28T13:30:00Z');
  await w.cycle();

  expect(updateCompanyIndustry).toHaveBeenCalledWith(APPLE.cik, '3571', 'Electronic Computers');
  expect(updateCompanyIndustry).toHaveBeenCalledWith(MSFT.cik, '6021', 'National Commercial Banks');
  expect(fetchSubmissions).toHaveBeenCalledTimes(2);
});

test('a failed company check records no industry for it', async () => {
  const w = world('2026-09-28T13:30:00Z');
  w.failChecksFor(MSFT.cik, true);
  await w.cycle();

  expect(updateCompanyIndustry).toHaveBeenCalledTimes(1);
  expect(updateCompanyIndustry).toHaveBeenCalledWith(APPLE.cik, '3571', 'Electronic Computers');
});

// Post-Phase 7 hardening, step 5: the heartbeat needs to see failed checks,
// which the old "companies checked" count hid (it counts attempts).
test('each cycle records how many companies could not be checked', async () => {
  const w = world('2026-09-28T13:30:00Z');
  await w.cycle();
  expect(pollerRepository.completePollerRun).toHaveBeenLastCalledWith(1, 2, 0, 0);

  w.failChecksFor(MSFT.cik, true);
  w.advance(30);
  const result = await w.cycle();

  expect(pollerRepository.completePollerRun).toHaveBeenLastCalledWith(1, 2, 0, 1);
  expect(result).toMatchObject({ companiesChecked: 2, companiesFailed: 1 });
});
