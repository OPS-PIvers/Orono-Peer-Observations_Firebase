import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Default to desktop viewport for component tests so responsive
// switches (e.g. RubricRow's mobile-vs-desktop layout) render the
// desktop tree. JSDOM doesn't ship matchMedia, so we stub it to
// return matches=true for any min-width query.
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes('min-width'),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
});
