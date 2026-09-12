import { Logger } from 'pino';

export {};

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string };
      // Attached by pino-http (see src/app.ts) - a per-request child logger
      // whose lines share this request's `reqId`, so a route handler's own
      // error log line correlates directly with the access-log line for the
      // request that caused it, rather than the two being unrelated.
      log: Logger;
    }
  }
}
