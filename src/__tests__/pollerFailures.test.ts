/**
 * Post-Phase 7 hardening, step 5 - the heartbeat's blind spot.
 *
 * The poller counts a company as checked before it tries it, and moves on
 * when the check fails, so a poller that SEC blocks still completes every
 * cycle with "196 companies checked" - and the silence alert, which only asks
 * whether cycles complete, never fires. Each cycle now records how many
 * companies failed, and the heartbeat alerts once per outage when two
 * consecutive cycles fail for more than half of them.
 *
 * Like alerting.test.ts, this steps through simulated time against an
 * in-memory stand-in for the tables; nothing connects anywhere.
 */
jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

import { pool } from '../db';
import { checkPollerFailures } from '../alerting';

const MINUTE = 60_000;
const T0 = new Date('2026-10-02T12:00:00Z').getTime();
const UNIVERSE = 196;

interface Run {
  finishedAt: Date;
  checked: number;
  failed: number;
}

function world(deliver: (text: string) => Promise<void> = async () => undefined) {
  let clock = T0;
  const runs: Run[] = [];
  let lastAlertedAt: Date | undefined;
  const sent: string[] = [];

  (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.includes('ORDER BY finished_at DESC LIMIT 2')) {
      return {
        rows: [...runs]
          .reverse()
          .slice(0, 2)
          .map((r) => ({ finished_at: r.finishedAt, companies_checked: r.checked, companies_failed: r.failed })),
      };
    }
    if (sql.includes('max(finished_at)')) {
      const healthy = runs.filter((r) => r.failed * 2 <= r.checked).at(-1);
      return { rows: [{ last_healthy: healthy?.finishedAt ?? null }] };
    }
    if (sql.startsWith('SELECT last_alerted_at')) return { rows: lastAlertedAt ? [{ last_alerted_at: lastAlertedAt }] : [] };
    if (sql.includes('INSERT INTO alert_state')) {
      lastAlertedAt = new Date(clock);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  return {
    sent,
    /** One poll cycle every 30 minutes, with `failed` of the 196 companies failing; a heartbeat check after each. */
    cycles: async function (count: number, failed: number) {
      let alerts = 0;
      for (let i = 0; i < count; i += 1) {
        clock += 30 * MINUTE;
        runs.push({ finishedAt: new Date(clock), checked: UNIVERSE, failed });
        const { alerted } = await checkPollerFailures({
          send: async (text) => {
            await deliver(text);
            sent.push(text);
          },
        });
        if (alerted) alerts += 1;
      }
      return alerts;
    },
  };
}

beforeEach(() => jest.clearAllMocks());

test('a healthy poller - every company checked, every cycle - never alerts', async () => {
  const w = world();
  expect(await w.cycles(48, 0)).toBe(0);
});

test('SEC blocking the server - every cycle completes, every check fails - alerts exactly once', async () => {
  const w = world();
  await w.cycles(4, 0);

  expect(await w.cycles(8, UNIVERSE)).toBe(1);
  expect(w.sent[0]).toMatch(/could not check 196 of 196 companies/);
  expect(w.sent[0]).toMatch(/SEC may be blocking/);
});

test('one bad cycle is not an outage', async () => {
  const w = world();
  await w.cycles(4, 0);

  expect(await w.cycles(1, UNIVERSE)).toBe(0);
  expect(await w.cycles(4, 0)).toBe(0);
});

test('a few persistently broken companies are not an outage - quarantine handles those', async () => {
  const w = world();
  expect(await w.cycles(12, 10)).toBe(0);
});

test('after recovery, the next blocking episode alerts again - once', async () => {
  const w = world();
  await w.cycles(2, 0);
  expect(await w.cycles(6, UNIVERSE)).toBe(1);
  await w.cycles(3, 0);

  expect(await w.cycles(6, 150)).toBe(1);
  expect(w.sent).toHaveLength(2);
});

test('if delivery fails, the alert is not recorded and the next check sends it', async () => {
  let deliveries = 0;
  const w = world(async () => {
    deliveries += 1;
    if (deliveries === 1) throw new Error('Slack rejected the alert: HTTP 500');
  });
  await w.cycles(1, 0);

  await expect(w.cycles(2, UNIVERSE)).rejects.toThrow('HTTP 500');
  expect(await w.cycles(1, UNIVERSE)).toBe(1);
});
