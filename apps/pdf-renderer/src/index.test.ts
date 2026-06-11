import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Hono } from 'hono';
import { OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation, type Rubric } from '@ops/shared';

/**
 * The renderer caches Chromium in a module-level singleton (getBrowser in
 * index.ts). The regression these tests guard against: a rejected
 * `puppeteer.launch` (transient OOM, cold-start race) stayed cached
 * forever, so every finalization 500'd until Cloud Run recycled the
 * container — and a browser that crashed *after* a successful launch was
 * likewise never replaced.
 *
 * `puppeteer.launch` is mocked; `vi.resetModules()` + a fresh dynamic
 * import give each test its own singleton. The module's `serve()` call is
 * skipped under Vitest (see the VITEST guard in index.ts), so importing it
 * never binds a port.
 */

const launchMock = vi.hoisted(() => vi.fn());

vi.mock('puppeteer', () => ({
  default: { launch: launchMock },
}));

interface FakePage {
  setContent: Mock;
  pdf: Mock;
  close: Mock;
}

interface FakeBrowser {
  connected: boolean;
  newPage: () => Promise<FakePage>;
}

function makeFakePage(): FakePage {
  return {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeFakeBrowser(page: FakePage = makeFakePage()): FakeBrowser {
  return {
    connected: true,
    newPage: () => Promise.resolve(page),
  };
}

/** Re-evaluate index.ts so each test starts with an empty browser cache. */
function loadRenderer() {
  vi.resetModules();
  return import('./index.js');
}

const rubric: Rubric = {
  rubricId: 'teacher-rubric',
  displayName: 'Teacher Rubric',
  domains: [
    {
      id: '1',
      name: 'Planning and Preparation',
      components: [
        {
          id: '1a',
          title: 'Demonstrating Knowledge of Content and Pedagogy',
          proficiencyLevels: {
            developing: 'Developing descriptor',
            basic: 'Basic descriptor',
            proficient: 'Proficient descriptor',
            distinguished: 'Distinguished descriptor',
          },
          lookFors: [],
        },
      ],
    },
  ],
  createdAt: new Date('2025-08-01T12:00:00.000Z'),
  updatedAt: new Date('2025-08-01T12:00:00.000Z'),
};

const observation: Observation = {
  observationId: 'obs1',
  observerEmail: 'pe@orono.k12.mn.us',
  observedEmail: 'teacher@orono.k12.mn.us',
  observedName: 'Terry Teacher',
  observedRole: 'Teacher',
  observedYear: 1,
  observedBuildings: ['Middle School'],
  status: OBSERVATION_STATUS.finalized,
  type: OBSERVATION_TYPES.standard,
  observationName: '',
  observationDate: new Date('2026-03-05T12:00:00.000Z'),
  observationData: {},
  componentNotes: {},
  componentTags: [],
  audioDriveFileIds: [],
  transcripts: {},
  driveFolderId: null,
  pdfDriveFileId: null,
  createdAt: new Date('2026-03-01T12:00:00.000Z'),
  lastModifiedAt: new Date('2026-03-05T12:00:00.000Z'),
  finalizedAt: null,
  acknowledgedAt: null,
  windowId: null,
  slotId: null,
  scheduledStartAt: null,
  scheduledEndAt: null,
  gcalEventIds: {},
  signupDetails: [],
};

function postRender(app: Hono): Promise<Response> {
  return Promise.resolve(
    app.request('/render-observation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observation, rubric, activeComponentIds: [] }),
    }),
  );
}

beforeEach(() => {
  launchMock.mockReset();
  // onError logs every failure; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getBrowser', () => {
  it('launches once and caches the browser across calls', async () => {
    const { getBrowser } = await loadRenderer();
    const browser = makeFakeBrowser();
    launchMock.mockResolvedValue(browser);

    await expect(getBrowser()).resolves.toBe(browser);
    await expect(getBrowser()).resolves.toBe(browser);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed launch — the next call retries', async () => {
    const { getBrowser } = await loadRenderer();
    const browser = makeFakeBrowser();
    launchMock.mockRejectedValueOnce(new Error('cold-start OOM')).mockResolvedValueOnce(browser);

    await expect(getBrowser()).rejects.toThrow('cold-start OOM');
    await expect(getBrowser()).resolves.toBe(browser);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one failed launch among concurrent callers, then recovers', async () => {
    const { getBrowser } = await loadRenderer();
    const browser = makeFakeBrowser();
    launchMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(browser);

    const results = await Promise.allSettled([getBrowser(), getBrowser()]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(launchMock).toHaveBeenCalledTimes(1);

    await expect(getBrowser()).resolves.toBe(browser);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('relaunches when the cached browser has disconnected', async () => {
    const { getBrowser } = await loadRenderer();
    const crashed = makeFakeBrowser();
    const replacement = makeFakeBrowser();
    launchMock.mockResolvedValueOnce(crashed).mockResolvedValueOnce(replacement);

    await expect(getBrowser()).resolves.toBe(crashed);
    crashed.connected = false; // Chromium dies after a successful launch.

    await expect(getBrowser()).resolves.toBe(replacement);
    await expect(getBrowser()).resolves.toBe(replacement);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('retries again when the relaunch after a disconnect also fails', async () => {
    const { getBrowser } = await loadRenderer();
    const crashed = makeFakeBrowser();
    const replacement = makeFakeBrowser();
    launchMock
      .mockResolvedValueOnce(crashed)
      .mockRejectedValueOnce(new Error('relaunch failed'))
      .mockResolvedValueOnce(replacement);

    await expect(getBrowser()).resolves.toBe(crashed);
    crashed.connected = false;

    await expect(getBrowser()).rejects.toThrow('relaunch failed');
    await expect(getBrowser()).resolves.toBe(replacement);
    expect(launchMock).toHaveBeenCalledTimes(3);
  });
});

describe('HTTP routes', () => {
  it('GET /healthz reports ok', async () => {
    const { app } = await loadRenderer();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok', service: 'pdf-renderer' });
  });

  it('POST /render-observation renders a PDF via the shared browser', async () => {
    const { app } = await loadRenderer();
    const page = makeFakePage();
    launchMock.mockResolvedValue(makeFakeBrowser(page));

    const res = await postRender(app);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(page.setContent).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('returns a structured 500 on launch failure and recovers on the next request', async () => {
    const { app } = await loadRenderer();
    launchMock
      .mockRejectedValueOnce(new Error('chromium failed to start'))
      .mockResolvedValueOnce(makeFakeBrowser());

    const failed = await postRender(app);
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({
      error: 'render_failed',
      message: 'chromium failed to start',
    });

    const recovered = await postRender(app);
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('Content-Type')).toBe('application/pdf');
  });
});
