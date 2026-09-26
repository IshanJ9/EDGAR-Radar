import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * The company universe (data/company-universe.json) and the project root it
 * lives in - post-Phase 7, step 2.
 *
 * The poller, reconciliation and the backfill each used to locate the file
 * with `path.join(__dirname, '..', 'data', ...)`. That is right under
 * ts-node, where the code runs from `src/` or `scripts/`, and wrong once
 * compiled, where it runs from `dist/src/` or `dist/scripts/` and `..` is
 * `dist/`. It is why none of the three could run in the production image,
 * and why production never discovered a new filing on its own (see
 * PROGRESS.md). Walking up to the directory holding package.json gives the
 * same answer from either location.
 */

export interface UniverseEntry {
  cik: string;
  ticker: string;
  name: string;
}

/** Nearest ancestor of `startDir` (inclusive) that contains package.json. */
export function findProjectRoot(startDir: string = __dirname): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`No package.json found in ${startDir} or any directory above it`);
    }
    dir = parent;
  }
}

export function loadUniverse(root: string = findProjectRoot()): UniverseEntry[] {
  return JSON.parse(readFileSync(path.join(root, 'data', 'company-universe.json'), 'utf-8'));
}
