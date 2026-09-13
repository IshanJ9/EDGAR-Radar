import express from 'express';
import pinoHttp from 'pino-http';
import companiesRouter from './routes/companies';
import authRouter from './routes/auth';
import watchlistRouter from './routes/watchlist';
import { bullBoardRouter } from './bullBoard';
import { createLogger } from './logger';

export const app = express();

// One structured access-log line per request/response, tagged `service:
// "api"` via the shared logger (see src/logger.ts) rather than pino-http's
// own default logger instance - so request logs and every route handler's
// own logs share the same JSON-in-production/pretty-in-dev formatting and
// service tag, instead of two independently-configured loggers drifting
// apart. Mounted before the routers so every request is logged, including
// ones that 404.
app.use(pinoHttp({ logger: createLogger('api') }));

app.use(express.json());
app.use('/companies', companiesRouter);
app.use('/auth', authRouter);
app.use('/watchlist', watchlistRouter);

// Bull Board is an unauthenticated, WRITE-CAPABLE admin surface - it can
// retry, promote and delete jobs, not just display them. That was fine while
// this app only ever ran on localhost, which is what bullBoard.ts's own
// comment anticipated ("would need requireAuth ... before ever being
// deployed"). Phase 6 step 8 deployed the stack to a public IP, at which
// point it became genuinely reachable by anyone: a request to
// /admin/queues from the open internet returned 200.
//
// Gated off by default rather than on, so that forgetting to set anything is
// the safe outcome instead of the exposed one. Set ENABLE_BULL_BOARD=true for
// local development; in production, reach it by tunnelling instead
// (`ssh -L 3000:localhost:3000 ...`), which needs no public exposure at all.
//
// An auth gate in front of it was considered and rejected for now: this
// deployment has no TLS yet, so HTTP basic auth would put credentials on the
// wire in the clear - strictly worse than not serving the route.
if (process.env.ENABLE_BULL_BOARD === 'true') {
  app.use('/admin/queues', bullBoardRouter);
}
