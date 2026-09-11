import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { filingDiscoveredQueue, filingParsedQueue, scoresUpdatedQueue } from './queues';

/**
 * Read-only visibility into the Phase 4 pipeline's three queues - lets you
 * watch a filing move through filing.discovered -> filing.parsed ->
 * scores.updated, and inspect failed/stalled jobs, without querying Redis
 * directly. Not authenticated yet (no auth gate exists on it) - acceptable
 * for local dev, same as the rest of this phase's infra; would need
 * `requireAuth` (or a separate admin check) before ever being deployed
 * (Phase 6+).
 */
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(filingDiscoveredQueue),
    new BullMQAdapter(filingParsedQueue),
    new BullMQAdapter(scoresUpdatedQueue),
  ],
  serverAdapter,
});

export const bullBoardRouter = serverAdapter.getRouter();
