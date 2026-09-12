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
app.use('/admin/queues', bullBoardRouter);
