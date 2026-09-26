import 'dotenv/config';
// Must stay directly after dotenv and before every other import - see
// src/bootstrap/validateApiEnv.ts.
import './bootstrap/validateApiEnv';
import { app } from './app';
import { createLogger } from './logger';
import { initResponseCache } from './cache';

const logger = createLogger('api');

// Phase 7 step 3 - a no-op unless CACHE_REDIS_URL is set. See src/cache.ts
// for why this is an explicit call rather than an import-time connection.
initResponseCache();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'EDGAR Radar API listening');
});
