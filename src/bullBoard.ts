import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { filingDiscoveredQueue, filingParsedQueue, scoresUpdatedQueue } from './queues';

/**
 * Read-only visibility into the Phase 4 pipeline's three queues - lets you
 * watch a filing move through filing.discovered -> filing.parsed ->
 * scores.updated, and inspect failed/stalled jobs, without querying Redis
 * directly. Despite the "read-only visibility" framing above, the dashboard
 * itself is not read-only: it can retry, promote and delete jobs.
 *
 * Still unauthenticated - but as of Phase 6 step 9 it is no longer mounted by
 * default. `app.ts` mounts it only when ENABLE_BULL_BOARD=true, because step
 * 8 deployed this app to a public IP and confirmed /admin/queues was serving
 * HTTP 200 to the open internet. See the comment at that mount point for why
 * gating was chosen over an auth gate (no TLS on the deployment yet).
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
