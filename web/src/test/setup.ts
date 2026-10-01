import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';

// The company page is loaded lazily (App.tsx), and the first test to open it
// waits for Vitest to compile it and the charting library - 2-3 s, beyond the
// default 1 s wait of findBy* queries.
configure({ asyncUtilTimeout: 5000 });
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine and no ResizeObserver, which Recharts' responsive
// container needs. The charts' numbers are tested through the table that
// accompanies every chart, not through SVG geometry.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Like the backend's nock guard (jest.setup.ts): no test may reach the
// network. Every test that needs data stubs `fetch` itself; one that forgets
// fails loudly instead of quietly calling the production API.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected network request in a test: ${String(input)}`);
    }),
  );
});
