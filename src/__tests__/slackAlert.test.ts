/**
 * Post-Phase 7 hardening, step 2 - Slack delivery.
 *
 * sendSlackAlert used to log a rejected delivery and return normally, so the
 * heartbeat recorded the alert as sent and never retried it for that outage.
 * A rejection must now throw. Slack is mocked with nock; nothing leaves the
 * machine.
 */
jest.mock('../db', () => ({ pool: { query: jest.fn() } }));

import nock from 'nock';
import { sendSlackAlert } from '../alerting';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETTOKEN';

beforeEach(() => {
  process.env.ALERT_SLACK_WEBHOOK_URL = WEBHOOK;
});

afterEach(() => {
  delete process.env.ALERT_SLACK_WEBHOOK_URL;
  nock.cleanAll();
});

test('posts the text to the webhook as Slack JSON', async () => {
  const slack = nock('https://hooks.slack.com')
    .post('/services/T000/B000/SECRETTOKEN', { text: 'hello' })
    .reply(200, 'ok');

  await sendSlackAlert('hello');

  expect(slack.isDone()).toBe(true);
});

test('a delivery Slack rejects throws, so the caller does not treat it as sent', async () => {
  nock('https://hooks.slack.com').post('/services/T000/B000/SECRETTOKEN').reply(500, 'internal_error');

  await expect(sendSlackAlert('hello')).rejects.toThrow('Slack rejected the alert: HTTP 500');
});

test('the error never contains the webhook URL, which is a secret', async () => {
  nock('https://hooks.slack.com').post('/services/T000/B000/SECRETTOKEN').reply(404, 'no_service');

  const error = await sendSlackAlert('hello').catch((err: unknown) => err as Error);

  expect(error).toBeInstanceOf(Error);
  expect(error!.message).not.toContain('SECRETTOKEN');
});
