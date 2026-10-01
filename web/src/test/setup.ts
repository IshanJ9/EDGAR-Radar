import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

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
