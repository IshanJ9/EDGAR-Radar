/**
 * Orchestrates Phase 6 step 4's integration test run end-to-end as ONE
 * command, so a developer and CI (Phase 6, step 7) can invoke this
 * identically:
 *
 *   1. Start a throwaway, ephemeral Postgres (docker-compose.test.yml) -
 *      tmpfs-backed, no named volume, on a distinct port/project name so it
 *      can run alongside docker-compose.yml's dev/prod-shaped stack.
 *   2. Run every real migration against it, fresh.
 *   3. Run the integration test suite (jest.integration.config.js) with
 *      DATABASE_URL pointed at this throwaway instance.
 *   4. ALWAYS tear the container down afterward - a real try/finally, not
 *      shell chaining. Package.json scripts run through whatever shell npm
 *      picks per-OS (cmd.exe on Windows unless configured otherwise), where
 *      a bash-style "run tests; capture exit code; teardown; re-exit with
 *      that code" one-liner isn't reliably portable - this project has hit
 *      exactly that kind of cross-platform shell fragility before (see the
 *      PowerShell-specific tool notes elsewhere in this project). Doing the
 *      orchestration in Node sidesteps it entirely.
 *   5. Exit with the test run's real exit code, so CI correctly reports
 *      failure rather than always seeing the teardown command's exit code.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

const COMPOSE_FILE = path.join(__dirname, '..', 'docker-compose.test.yml');
const COMPOSE_PROJECT = 'edgar-radar-test';
// 127.0.0.1, not "localhost": confirmed for real that on this Windows host
// Node resolves "localhost" to ::1 (IPv6) first, and connections to Docker
// Desktop's port-forwarding over IPv6 get reset (ECONNRESET) even though
// the exact same connection over IPv4 (127.0.0.1) succeeds immediately -
// verified directly by running node-pg-migrate against each host in turn.
// This is the same class of finding as Phase 6 step 1's "HTTP 000 vs
// 127.0.0.1" result, now confirmed as a general pattern on this host/Docker
// setup rather than an HTTP-specific quirk.
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/edgar_radar_test';

function run(command: string, args: string[], extraEnv?: NodeJS.ProcessEnv): number {
  // shell:true on Windows is needed because `docker`/`npx` resolve to .cmd
  // shims there, which spawnSync can't exec directly without a shell. Node
  // warns (DEP0190) that shell mode doesn't escape args - a real footgun in
  // general, but every argument passed through `run()` in this file is a
  // static literal, never interpolated from user input or filing content,
  // so there is nothing here for that warning to actually protect against.
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`Failed to run "${command} ${args.join(' ')}":`, result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function teardown(): void {
  console.log('\nTearing down the throwaway test Postgres...');
  run('docker', ['compose', '-f', COMPOSE_FILE, '-p', COMPOSE_PROJECT, 'down', '-v']);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries `node-pg-migrate up` a few times on a connection-level failure.
 *
 * This did NOT turn out to be the fix for the real bug hit while building
 * this script (that was the `localhost`-vs-`127.0.0.1` IPv6 issue explained
 * above TEST_DATABASE_URL - a wrong first diagnosis here mistook that
 * consistent, every-attempt IPv6 failure for a one-off container-startup
 * race, since both present as the exact same ECONNRESET). Left in as a
 * genuine, separate safety net for actual transient Docker-Desktop-on-
 * Windows flakiness around freshly-started containers - the same "retry a
 * transient failure" philosophy this project already applies to SEC calls
 * (src/retry.ts) - not because it was the explanation for what was
 * actually observed.
 */
async function runMigrationsWithRetry(maxAttempts = 5): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = run('npx', ['node-pg-migrate', 'up'], { DATABASE_URL: TEST_DATABASE_URL });
    if (exitCode === 0) return 0;
    if (attempt === maxAttempts) return exitCode;
    console.log(`Migration attempt ${attempt}/${maxAttempts} failed - retrying in 1s...`);
    await sleep(1000);
  }
  return 1;
}

async function main(): Promise<void> {
  console.log('Starting throwaway test Postgres (docker-compose.test.yml)...');
  const upExit = run('docker', ['compose', '-f', COMPOSE_FILE, '-p', COMPOSE_PROJECT, 'up', '-d', '--wait']);
  if (upExit !== 0) {
    console.error(`Failed to start the test Postgres container (exit ${upExit}). Is Docker running?`);
    // Nothing to tear down if it never came up successfully - still attempt
    // it in case of a partial start, but don't let a second failure here
    // mask the real one.
    teardown();
    process.exit(upExit);
  }

  // exitCode is set inside the try and read after the finally - deliberately
  // NOT using an early `return` from within the try to skip the jest run on
  // a migration failure, since that would skip straight past the
  // `process.exit(exitCode)` below (a `return` here only exits `main()`,
  // after `finally` runs, not the process) and let Node exit on its own
  // with a false "success" code once the event loop empties - the opposite
  // of what a CI step checking this command's exit code needs.
  let exitCode = 1;
  try {
    console.log('Running migrations against the throwaway database...');
    const migrateExit = await runMigrationsWithRetry();
    if (migrateExit !== 0) {
      console.error(`Migrations failed (exit ${migrateExit}).`);
      exitCode = migrateExit;
    } else {
      console.log('Running integration tests...');
      exitCode = run('npx', ['jest', '--config', 'jest.integration.config.js'], { DATABASE_URL: TEST_DATABASE_URL });
    }
  } finally {
    teardown();
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
