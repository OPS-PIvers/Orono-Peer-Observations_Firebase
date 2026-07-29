/**
 * AuthProvider — PLAT-09 session-timeout "Stay signed in" tests.
 *
 * OWNER DECISION: "Stay signed in" must genuinely re-authenticate via
 * `reauthenticateWithPopup` rather than tracking a client-side "extended
 * until" anchor, since a client assertion can't be trusted to actually
 * re-prove identity on a shared/lab device. These tests cover:
 *   - the happy path: reauth succeeds, a fresh auth_time moves the
 *     deadline, and the warning banner clears.
 *   - the popup-dismissed path: reauth fails, the user stays signed in,
 *     the warning banner stays up (with a retry affordance), and nothing
 *     silently stops the countdown.
 *
 * Plus two cross-feature integration regressions, both about the timeout
 * meeting the observation editor (#77 auto-tag review dialog, #84 rubric
 * controls):
 *   - the warning must stay visible, clickable and inside the focus trap
 *     when a modal dialog is open, or an observer mid-observation never
 *     sees it and gets the silent sign-out the warn-first design prevents.
 *   - pending editor work must be flushed BEFORE auth is invalidated, and
 *     sign-out must still happen if that flush fails.
 */
import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const { authCallbacks, mockReauthenticateWithPopup, mockSignOut, mockGoogleAuthProvider } =
  vi.hoisted(() => {
    const authCallbacks: {
      authState?: (user: unknown) => void;
      idToken?: (user: unknown) => void;
    } = {};
    return {
      authCallbacks,
      mockReauthenticateWithPopup: vi.fn(),
      mockSignOut: vi.fn(() => Promise.resolve()),
      mockGoogleAuthProvider: vi.fn(function FakeGoogleAuthProvider(this: {
        setCustomParameters: () => void;
      }) {
        this.setCustomParameters = vi.fn();
      }),
    };
  });

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null as unknown },
  db: {},
  functions: {},
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: mockGoogleAuthProvider,
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authCallbacks.authState = cb;
    return () => undefined;
  },
  onIdTokenChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authCallbacks.idToken = cb;
    return () => undefined;
  },
  reauthenticateWithPopup: mockReauthenticateWithPopup,
  signOut: mockSignOut,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(() => Promise.resolve({ data: {} })),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ kind: 'doc' })),
  // No app settings doc in these tests — AuthProvider falls back to the
  // 24h default session duration.
  onSnapshot: (_ref: unknown, onNext: (snap: unknown) => void) => {
    onNext({ exists: () => false, data: () => undefined, id: 'global' });
    return () => undefined;
  },
}));

import { auth } from '@/lib/firebase';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AuthProvider, useAuth } from './AuthProvider';
import { registerForcedSignOutFlush } from './forcedSignOutFlush';

// ─── Test helpers ───────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const SESSION_DURATION_MS = 24 * HOUR_MS;

function makeFakeUser(overrides: { authTime: string; getIdTokenResult?: () => Promise<unknown> }) {
  return {
    uid: 'staff-1',
    email: 'teacher@orono.k12.mn.us',
    getIdToken: vi.fn(() => Promise.resolve('fake-token')),
    getIdTokenResult:
      overrides.getIdTokenResult ??
      vi.fn(() =>
        Promise.resolve({
          authTime: overrides.authTime,
          claims: { role: 'Teacher', hasSpecialAccess: false, isAdmin: false },
        }),
      ),
  };
}

function StatusProbe() {
  const { status } = useAuth();
  return <div data-testid="status">{status}</div>;
}

function renderProvider(children?: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <StatusProbe />
          {children}
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Stand-in for the Auto-tag review dialog (#77) — any app dialog behaves the
 *  same way, since they all go through components/ui/dialog.tsx. */
function OpenModalDialog() {
  return (
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Review auto-tag suggestions</DialogTitle>
        <button type="button">Apply 2 tags</button>
      </DialogContent>
    </Dialog>
  );
}

/** Drives a fake sign-in with an `auth_time` positioned `msBeforeDeadline`
 *  before the session-duration deadline — i.e. already inside the warning
 *  window when `msBeforeDeadline <= SESSION_WARNING_WINDOW_MS`. */
async function signIn(msBeforeDeadline: number, user?: ReturnType<typeof makeFakeUser>) {
  const authTime = new Date(Date.now() - (SESSION_DURATION_MS - msBeforeDeadline)).toISOString();
  const fakeUser = user ?? makeFakeUser({ authTime });
  (auth as { currentUser: unknown }).currentUser = fakeUser;
  await act(async () => {
    authCallbacks.authState?.(fakeUser);
    authCallbacks.idToken?.(fakeUser);
    // Flush the async IIFE inside onIdTokenChanged's handler.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
  });
  return fakeUser;
}

afterEach(() => {
  vi.clearAllMocks();
  (auth as { currentUser: unknown }).currentUser = null;
});

describe('AuthProvider — "Stay signed in" re-authentication', () => {
  it('clears the warning banner once reauthenticateWithPopup succeeds with a fresh auth_time', async () => {
    renderProvider();
    await signIn(4 * 60 * 1000); // 4 minutes before deadline: inside the 5-minute warning window

    expect(await screen.findByText(/Your session will expire in/)).toBeInTheDocument();

    const freshAuthTime = new Date().toISOString();
    mockReauthenticateWithPopup.mockResolvedValueOnce({
      user: { getIdTokenResult: () => Promise.resolve({ authTime: freshAuthTime, claims: {} }) },
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));

    await waitFor(() => {
      expect(screen.queryByText(/Your session will expire in/)).not.toBeInTheDocument();
    });
    expect(mockReauthenticateWithPopup).toHaveBeenCalledTimes(1);
    // Still signed in — a successful reauth must not sign the user out.
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('keeps the user signed in and the warning visible when the popup is dismissed, and lets them retry', async () => {
    renderProvider();
    await signIn(4 * 60 * 1000);

    expect(await screen.findByText(/Your session will expire in/)).toBeInTheDocument();

    mockReauthenticateWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));

    // The countdown must not have silently stopped: the warning banner
    // stays up, with an explanation and a way to retry.
    await waitFor(() => {
      expect(
        screen.getByText(/Sign-in was cancelled\. Try again before your session expires\./),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Your session will expire in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();

    // Never leave the UI signed out just because the popup was dismissed.
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
    expect(mockSignOut).not.toHaveBeenCalled();

    // Retry succeeds.
    const freshAuthTime = new Date().toISOString();
    mockReauthenticateWithPopup.mockResolvedValueOnce({
      user: { getIdTokenResult: () => Promise.resolve({ authTime: freshAuthTime, claims: {} }) },
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.queryByText(/Your session will expire in/)).not.toBeInTheDocument();
    });
  });

  it('surfaces a popup-blocked message distinctly and still leaves the session intact', async () => {
    renderProvider();
    await signIn(4 * 60 * 1000);
    expect(await screen.findByText(/Your session will expire in/)).toBeInTheDocument();

    mockReauthenticateWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Your browser blocked the sign-in popup\. Allow popups and try again\./),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('signed-in');
  });
});

describe('AuthProvider — the session warning vs. an open modal dialog', () => {
  it('keeps "Stay signed in" visible, single, and inside the dialog so it is clickable and tabbable', async () => {
    renderProvider(<OpenModalDialog />);
    await signIn(4 * 60 * 1000);

    // Radix portals dialog content to the END of <body> at z-50, locks
    // `body { pointer-events: none }`, marks the rest of the page
    // aria-hidden and traps focus inside it. A plain page-level banner is
    // therefore invisible, unclickable and unreachable — so the warning has
    // to render inside the dialog while one is open.
    const dialog = await screen.findByRole('dialog');
    const stay = await screen.findByRole('button', { name: 'Stay signed in' });
    expect(dialog).toContainElement(stay);
    // Exactly one copy: never announced or rendered twice.
    expect(screen.getAllByRole('button', { name: 'Stay signed in' })).toHaveLength(1);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Your session will expire in/);

    // ...and it actually works from there: a real reauth, not a no-op.
    const freshAuthTime = new Date().toISOString();
    mockReauthenticateWithPopup.mockResolvedValueOnce({
      user: { getIdTokenResult: () => Promise.resolve({ authTime: freshAuthTime, claims: {} }) },
    });

    const user = userEvent.setup();
    await user.click(stay);

    expect(mockReauthenticateWithPopup).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText(/Your session will expire in/)).not.toBeInTheDocument();
    });
    // The dialog the observer was working in is still open and intact.
    expect(screen.getByRole('button', { name: 'Apply 2 tags' })).toBeInTheDocument();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('renders the warning outside the app tree (own portal) when no dialog is open', async () => {
    const { container } = renderProvider();
    await signIn(4 * 60 * 1000);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Your session will expire in/);
    // Not in document order behind the z-50 overlay/header layer.
    expect(container).not.toContainElement(alert);
  });
});

describe('AuthProvider — flushing pending editor work before a forced sign-out', () => {
  /** Already past the deadline: the next poll must force a sign-out. */
  const PAST_DEADLINE_MS = -1000;

  it('lands a pending editor save BEFORE auth is invalidated', async () => {
    const order: string[] = [];
    mockSignOut.mockImplementationOnce(() => {
      order.push('signOut');
      return Promise.resolve();
    });
    // Stands in for ObservationEditorPage's debounced autosave flush.
    const unregister = registerForcedSignOutFlush(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('flush');
    });

    try {
      renderProvider();
      await signIn(PAST_DEADLINE_MS);

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledTimes(1);
      });
      expect(order).toEqual(['flush', 'signOut']);
    } finally {
      unregister();
    }
  });

  it('still signs out when the flush fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const order: string[] = [];
    mockSignOut.mockImplementationOnce(() => {
      order.push('signOut');
      return Promise.resolve();
    });
    const unregister = registerForcedSignOutFlush(() => {
      order.push('flush');
      return Promise.reject(new Error('permission-denied'));
    });

    try {
      renderProvider();
      await signIn(PAST_DEADLINE_MS);

      // A failed flush must not swallow the sign-out — the deadline is a
      // security control, and unsaved work never gets to veto it.
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledTimes(1);
      });
      expect(order).toEqual(['flush', 'signOut']);
      expect(warn).toHaveBeenCalled();
    } finally {
      unregister();
      warn.mockRestore();
    }
  });
});
