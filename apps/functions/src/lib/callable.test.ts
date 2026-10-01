import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  onCall: (_opts: unknown, fn: unknown) => fn,
}));

import { assertDemoEditTarget, onCall } from './callable';

type Handler = (req: { auth?: { token: Record<string, unknown> } }) => unknown;

const demoAuth = {
  token: { email: 'admin@orono.k12.mn.us', demoEditBy: 'viewer@orono.k12.mn.us' },
};
const normalAuth = { token: { email: 'admin@orono.k12.mn.us' } };

function dbWith(staff: Record<string, Record<string, unknown>>) {
  return {
    doc: (path: string) => {
      const id = path.split('/')[1] ?? '';
      return { get: () => Promise.resolve({ exists: id in staff, data: () => staff[id] }) };
    },
  } as never;
}

describe('onCall wrapper', () => {
  it('refuses demo-edit sessions by default', () => {
    const fn = onCall({}, () => 'ran') as unknown as Handler;
    expect(() => fn({ auth: demoAuth })).toThrow(/demo/);
    expect(fn({ auth: normalAuth })).toBe('ran');
  });

  it('lets opted-in callables run in demo-edit sessions', () => {
    const fn = onCall({ allowDemoEdit: true }, () => 'ran') as unknown as Handler;
    expect(fn({ auth: demoAuth })).toBe('ran');
  });
});

describe('assertDemoEditTarget', () => {
  const db = dbWith({
    'spartan.teacher@orono.k12.mn.us': { isDemo: true },
    'real@orono.k12.mn.us': {},
  });

  it('only lets a demo-edit session reach demo staff', async () => {
    await expect(
      assertDemoEditTarget(db, demoAuth, 'Spartan.Teacher@orono.k12.mn.us'),
    ).resolves.toBeUndefined();
    await expect(assertDemoEditTarget(db, demoAuth, 'real@orono.k12.mn.us')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('is a no-op outside demo-edit sessions', async () => {
    await expect(
      assertDemoEditTarget(db, normalAuth, 'real@orono.k12.mn.us'),
    ).resolves.toBeUndefined();
  });
});
