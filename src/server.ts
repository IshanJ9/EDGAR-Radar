import 'dotenv/config';
// Must stay directly after dotenv and before every other import - see
// src/bootstrap/validateApiEnv.ts.
import './bootstrap/validateApiEnv';
import { app } from './app';
import { createLogger } from './logger';

const logger = createLogger('api');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'EDGAR Radar API listening');
});
