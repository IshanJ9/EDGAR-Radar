/**
 * Post-Phase 7, step 4 - the poller heartbeat alerts once per outage.
 *
 * Phase 3's real 48h run had a 3.5-day poller outage that produced 68 alerts:
 * repeats were suppressed only for 60 minutes after each one. These tests step
 * the heartbeat through simulated time - a check every 15 minutes, as
 * scripts/heartbeat.ts schedules it - against an in-memory stand-in for the
 * two tables it reads, and count what it sends. Nothing connects anywhere.
 */
jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

import { pool } from '../db';
import { checkPollerHeartbeat } from '../alerting';

const THRESHOLD = 60;
const MINUTE = 60_000;
const T0 = new Date('2026-09-26T12:00:00Z').getTime();

/** In-memory poller_runs (successes only) and alert_state, driven by a fake clock. */
function world(deliver: (text: string) => Promise<void> = async () => undefined) {
  let clock = T0;
  const successes: Date[] = [];
  let lastAlertedAt: Date | undefined;
  const sent: string[] = [];

  (pool.query as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM poller_runs')) {
      const latest = successes.at(-1);
      return { rows: latest ? [{ finished_at: latest }] : [] };
    }
    if (sql.startsWith('SELECT last_alerted_at')) {
      return { rows: lastAlertedAt ? [{ last_alerted_at: lastAlertedAt }] : [] };
    }
    if (sql.includes('INSERT INTO alert_state')) {
      lastAlertedAt = new Date(clock);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  const monitoringSince = new Date(T0);
  return {
    sent,
    pollSucceeds: () => successes.push(new Date(clock)),
    advance: (minutes: number) => (clock += minutes * MINUTE),
    /** One heartbeat check at the current time; returns whether it alerted. */
    check: async () =>
      (
        await checkPollerHeartbeat(THRESHOLD, {
          now: () => new Date(clock),
          monitoringSince,
          send: async (text) => {
            await deliver(text);
            sent.push(text);
          },
        })
      ).alerted,
    /** Checks every 15 minutes for `minutes`, returning how many alerted. */
    checksFor: async function (minutes: number) {
      let alerts = 0;
      for (let t = 0; t < minutes; t += 15) {
        this.advance(15);
        if (await this.check()) alerts += 1;
      }
      return alerts;
    },
  };
}

beforeEach(() => jest.clearAllMocks());

test('a healthy poller - a success every 30 minutes - never alerts', async () => {
  const w = world();
  for (let hour = 0; hour < 6; hour++) {
    w.pollSucceeds();
    await w.checksFor(30);
  }
  expect(w.sent).toHaveLength(0);
});

test('a 3.5-day outage - the one Phase 3 recorded - produces exactly one alert, not 68', async () => {
  const w = world();
  w.pollSucceeds();

  const alerts = await w.checksFor(3.5 * 24 * 60);

  expect(alerts).toBe(1);
  expect(w.sent).toHaveLength(1);
  expect(w.sent[0]).toContain('has not completed successfully in over 60 minutes');
});

test('the one alert comes at the first check past the threshold, not before', async () => {
  const w = world();
  w.pollSucceeds();

  expect(await w.checksFor(60)).toBe(0); // 15, 30, 45, 60 minutes: within the threshold
  w.advance(15);
  expect(await w.check()).toBe(true); // 75 minutes
});

test('after recovery, the next outage alerts again - once', async () => {
  const w = world();
  w.pollSucceeds();
  expect(await w.checksFor(3 * 60)).toBe(1); // first outage

  w.pollSucceeds(); // recovered
  expect(await w.checksFor(30)).toBe(0);

  expect(await w.checksFor(3 * 60)).toBe(1); // second outage
  expect(w.sent).toHaveLength(2);
});

test('a fresh deploy gets the full threshold before a "no cycle yet" alert', async () => {
  const w = world();

  expect(await w.check()).toBe(false); // the first check, at startup - the old false alarm
  expect(await w.checksFor(60)).toBe(0); // still within the grace period
  w.pollSucceeds(); // first cycle completes
  expect(await w.checksFor(30)).toBe(0);
  expect(w.sent).toHaveLength(0);
});

test('if delivery fails, the alert is not recorded and the next check sends it', async () => {
  let slackDown = true;
  const w = world(async () => {
    if (slackDown) throw new Error('Slack rejected the alert: HTTP 500');
  });
  w.pollSucceeds();
  expect(await w.checksFor(60)).toBe(0);

  w.advance(15);
  await expect(w.check()).rejects.toThrow('HTTP 500'); // 75 min: delivery fails

  slackDown = false;
  w.advance(15);
  expect(await w.check()).toBe(true); // 90 min: retried, delivered
  expect(await w.checksFor(60)).toBe(0); // then once per outage again
  expect(w.sent).toHaveLength(1);
});

test('a poller that never completes a cycle is reported once, after the threshold', async () => {
  const w = world();

  const alerts = await w.checksFor(6 * 60);

  expect(alerts).toBe(1);
  expect(w.sent[0]).toContain('has not completed a single cycle in the 60 minutes since monitoring began');
});
