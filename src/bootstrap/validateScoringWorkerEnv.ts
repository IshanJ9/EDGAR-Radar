/**
 * Imported first (after `dotenv/config`) by scripts/scoringWorker.ts. Same role
 * as src/bootstrap/validateApiEnv.ts - see that file for why import order is
 * what makes this work.
 */
import { exitIfEnvInvalid } from '../config';

exitIfEnvInvalid('scoring-worker');
