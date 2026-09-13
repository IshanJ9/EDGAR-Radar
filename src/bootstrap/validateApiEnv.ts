/**
 * Imported by src/server.ts immediately after `dotenv/config` and before
 * anything else, so the API checks its whole environment before app.ts pulls
 * in the modules that read env vars at import time (db.ts, sec.ts, queues.ts,
 * routes/auth.ts, middleware/requireAuth.ts). Without that ordering, whichever
 * of those happened to load first would throw about its own variable alone,
 * and a missing DATABASE_URL would not be reported at all until first use.
 *
 * TypeScript compiles these imports to `require` calls in source order, so
 * placement is what guarantees this runs first - the same property that
 * `import 'dotenv/config'` on the line above already depends on. The three
 * worker entrypoints each have an equivalent module alongside this one.
 * See src/config.ts.
 */
import { exitIfEnvInvalid } from '../config';

exitIfEnvInvalid('api');
