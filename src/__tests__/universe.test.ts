/**
 * Post-Phase 7, step 2 - locating the project root and the company universe
 * (src/universe.ts). The `__dirname`-relative path this replaces worked under
 * ts-node and broke once compiled, which is why production never ran the
 * poller; so the compiled layout is checked explicitly, not just the one these
 * tests happen to run from.
 */
import path from 'path';
import { findProjectRoot, loadUniverse } from '../universe';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('findProjectRoot', () => {
  test('from src/ - where ts-node runs the code', () => {
    expect(findProjectRoot(path.join(REPO_ROOT, 'src'))).toBe(REPO_ROOT);
  });

  test('from scripts/ - where the backfill runs under ts-node', () => {
    expect(findProjectRoot(path.join(REPO_ROOT, 'scripts'))).toBe(REPO_ROOT);
  });

  // The case that broke: compiled, the code runs from dist/src/ or
  // dist/scripts/, where the old `path.join(__dirname, '..')` gave dist/.
  // These directories need not exist - only package.json is looked for.
  test.each(['dist/src', 'dist/scripts'])('from %s - where compiled code runs', (dir) => {
    expect(findProjectRoot(path.join(REPO_ROOT, dir))).toBe(REPO_ROOT);
  });

  test('from the module itself by default', () => {
    expect(findProjectRoot()).toBe(REPO_ROOT);
  });

  test('fails with a clear error rather than guessing when there is no package.json above', () => {
    const fsRoot = path.parse(REPO_ROOT).root;
    expect(() => findProjectRoot(fsRoot)).toThrow('No package.json found');
  });
});

describe('loadUniverse', () => {
  test('reads the real 196-company universe, each with a CIK, ticker and name', () => {
    const universe = loadUniverse();
    expect(universe).toHaveLength(196);
    for (const company of universe) {
      expect(company.cik).toMatch(/^\d{1,10}$/);
      expect(company.ticker).toEqual(expect.any(String));
      expect(company.name).toEqual(expect.any(String));
    }
  });
});
