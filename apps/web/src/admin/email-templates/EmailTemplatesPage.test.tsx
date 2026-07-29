/**
 * EmailTemplatesPage — regression tests for the concurrent-save history bug
 * (PR #80 review finding #1) and the trim-to-fit safety net (finding #2).
 *
 * saveTemplate() must build the archived "previous version" from a
 * transactional read of the doc at write time, not from the local
 * `templates` snapshot (which lags a concurrent save from another admin by
 * a full onSnapshot round trip). These tests simulate that lag directly by
 * making the mocked transaction's `get()` return server-side content that
 * differs from what `useFirestoreCollection` (the stale local snapshot)
 * reports.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTemplate } from '@ops/shared';

// ─── Hoisted mocks ────────────────────────────────────────────────────────

const {
  templatesHolder,
  serverDocHolder,
  txSetMock,
  runTransactionMock,
  setDocMock,
  deleteDocMock,
  FakeTimestampCtor,
} = vi.hoisted(() => {
  class FakeTimestamp {
    private ms: number;
    constructor(ms: number) {
      this.ms = ms;
    }
    toDate(): Date {
      return new Date(this.ms);
    }
    toMillis(): number {
      return this.ms;
    }
    static fromDate(d: Date): FakeTimestamp {
      return new FakeTimestamp(d.getTime());
    }
  }

  return {
    // The local component's onSnapshot-backed view — deliberately stale in
    // the concurrent-save tests.
    templatesHolder: { current: [] as (EmailTemplate & { id: string })[] },
    // What a transactional `get()` returns — the true current server doc,
    // which may differ from templatesHolder when simulating a lag.
    serverDocHolder: {
      current: null as Partial<EmailTemplate> | null,
    },
    txSetMock: vi.fn(),
    runTransactionMock: vi.fn(),
    setDocMock: vi.fn(() => Promise.resolve()),
    deleteDocMock: vi.fn(() => Promise.resolve()),
    FakeTimestampCtor: FakeTimestamp,
  };
});

vi.mock('firebase/firestore', () => ({
  Timestamp: FakeTimestampCtor,
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
  serverTimestamp: () => 'server-timestamp',
  setDoc: setDocMock,
  deleteDoc: deleteDocMock,
  runTransaction: runTransactionMock,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(() => Promise.resolve({ data: { sent: true } })),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {}, auth: {}, storage: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin.b@orono.k12.mn.us' } }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({
    data: templatesHolder.current,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({ data: null, loading: false, error: null }),
}));

// The Tiptap-backed visual editor doesn't need to be exercised for these
// tests and is fragile under jsdom — swap it for a plain textarea.
vi.mock('./EmailBodyField', () => ({
  EmailBodyField: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea
      aria-label="Email body raw"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import type { EmailTemplateHistoryEntry } from '@ops/shared';
import { historyEntryKey } from './templateHistory';
import { EmailTemplatesPage, TemplateHistoryPanel } from './EmailTemplatesPage';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Shape of the payload passed to the mocked transaction's `set()` — named
 *  fields only (no index signature), so property access doesn't trip
 *  `noPropertyAccessFromIndexSignature`. */
interface WrittenTemplateData {
  subject?: string;
  bodyHtml?: string;
  history?: EmailTemplateHistoryEntry[];
}

function writtenDataFrom(call: unknown[] | undefined): WrittenTemplateData {
  if (!call) throw new Error('tx.set was not called');
  return call[1] as WrittenTemplateData;
}

function makeTemplate(
  overrides: Partial<EmailTemplate & { id: string }> = {},
): EmailTemplate & { id: string } {
  return {
    id: 'tmpl-1',
    templateId: 'tmpl-1',
    name: 'Welcome Email',
    description: '',
    subject: 'Original subject',
    bodyHtml: '<p>Original body</p>',
    variables: [],
    triggerType: 'manual',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: false,
    history: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EmailTemplatesPage />
    </MemoryRouter>,
  );
}

async function openEditorAndChangeSubject(user: ReturnType<typeof userEvent.setup>) {
  renderPage();
  const editBtn = await screen.findByRole('button', { name: /edit/i });
  await user.click(editBtn);

  const subjectInput = await screen.findByDisplayValue('Original subject');
  await user.clear(subjectInput);
  await user.type(subjectInput, 'Admin B subject');

  const saveBtn = screen.getByRole('button', { name: /^save$/i });
  await user.click(saveBtn);
}

// ─── Tests ────────────────────────────────────────────────────────────────

beforeEach(() => {
  txSetMock.mockClear();
  setDocMock.mockClear();
  deleteDocMock.mockClear();
  serverDocHolder.current = null;

  runTransactionMock.mockReset();
  runTransactionMock.mockImplementation(
    async (_db: unknown, updateFn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: () =>
          Promise.resolve({
            exists: () => serverDocHolder.current !== null,
            data: () => serverDocHolder.current ?? undefined,
          }),
        set: txSetMock,
      };
      return updateFn(tx);
    },
  );
});

describe('concurrent save (PR #80 review finding #1)', () => {
  it('builds the archived history entry from the transactional read, not the stale local snapshot', async () => {
    const user = userEvent.setup();

    // The local onSnapshot-backed `templates` prop is stale: it still shows
    // the pre-Admin-A content, because the listener hasn't delivered Admin
    // A's already-committed concurrent save yet.
    templatesHolder.current = [makeTemplate()];

    // But the actual server doc — what the transaction reads at write time
    // — already reflects Admin A's save.
    serverDocHolder.current = {
      ...makeTemplate(),
      subject: 'Admin A subject',
      bodyHtml: '<p>Admin A body</p>',
      history: [],
    };

    await openEditorAndChangeSubject(user);

    await waitFor(() => expect(txSetMock).toHaveBeenCalledTimes(1));
    const writtenData = writtenDataFrom(txSetMock.mock.calls[0]);

    // Admin B's own edit goes through as the new live value.
    expect(writtenData.subject).toBe('Admin B subject');

    // The archived version must be Admin A's content (from the
    // transactional read) — never the stale local snapshot's content. If
    // this were built from `templates?.find(...)` instead, it would equal
    // 'Original subject' / '<p>Original body</p>' and Admin A's edit would
    // be silently erased with zero trace.
    const history = writtenData.history ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]?.subject).toBe('Admin A subject');
    expect(history[0]?.bodyHtml).toBe('<p>Admin A body</p>');
    expect(history[0]?.subject).not.toBe('Original subject');
  });

  it('reads via a Firestore transaction rather than a plain setDoc', async () => {
    const user = userEvent.setup();
    templatesHolder.current = [makeTemplate()];
    serverDocHolder.current = makeTemplate();

    await openEditorAndChangeSubject(user);

    await waitFor(() => expect(runTransactionMock).toHaveBeenCalledTimes(1));
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('trim-to-fit safety net (PR #80 review finding #2)', () => {
  it('drops oldest history entries to keep the write under the byte budget', async () => {
    const user = userEvent.setup();
    templatesHolder.current = [makeTemplate()];

    const hugeOldEntry = {
      subject: 'Huge old entry',
      bodyHtml: '<p>' + 'x'.repeat(2_000_000) + '</p>',
      editedAt: new Date('2026-01-01T00:00:00Z'),
      editedBy: 'someone@orono.k12.mn.us',
    };
    serverDocHolder.current = {
      ...makeTemplate(),
      history: [hugeOldEntry],
    };

    await openEditorAndChangeSubject(user);

    await waitFor(() => expect(txSetMock).toHaveBeenCalledTimes(1));
    const writtenData = writtenDataFrom(txSetMock.mock.calls[0]);
    const history = writtenData.history ?? [];

    // The 2 MB history entry must not survive into the write — otherwise a
    // single oversized paste would permanently wedge every future save.
    expect(history.length).toBeLessThan(2);
  });

  it('still writes the live content even when the live body alone is enormous (degenerate case)', async () => {
    const user = userEvent.setup();
    templatesHolder.current = [makeTemplate()];
    // A normal-sized current server doc with no pre-existing history — the
    // oversized content here is the *new* live body the admin is saving,
    // not anything already archived.
    serverDocHolder.current = makeTemplate();

    renderPage();
    const editBtn = await screen.findByRole('button', { name: /edit/i });
    await user.click(editBtn);

    // fireEvent avoids simulating 2,000,000 individual keystrokes.
    const bodyField = await screen.findByLabelText('Email body raw');
    fireEvent.change(bodyField, { target: { value: '<p>' + 'x'.repeat(2_000_000) + '</p>' } });

    const saveBtn = screen.getByRole('button', { name: /^save$/i });
    await user.click(saveBtn);

    // Must resolve without throwing and without a save error — the save is
    // never permanently blocked, even though the live body alone leaves no
    // room for any history entry.
    await waitFor(() => expect(txSetMock).toHaveBeenCalledTimes(1));
    const writtenData = writtenDataFrom(txSetMock.mock.calls[0]);
    expect(writtenData.history).toEqual([]);
    expect(screen.queryByText(/save failed/i)).not.toBeInTheDocument();
  });
});

describe('TemplateHistoryPanel preview stability (PR #80 review finding #4)', () => {
  const entryA: EmailTemplateHistoryEntry = {
    subject: 'Version A',
    bodyHtml: '<p>A</p>',
    editedAt: new Date('2026-01-01T00:00:00Z'),
    editedBy: 'a@orono.k12.mn.us',
  };
  const entryB: EmailTemplateHistoryEntry = {
    subject: 'Version B',
    bodyHtml: '<p>B</p>',
    editedAt: new Date('2026-01-02T00:00:00Z'),
    editedBy: 'b@orono.k12.mn.us',
  };
  const entryC: EmailTemplateHistoryEntry = {
    subject: 'Version C',
    bodyHtml: '<p>C</p>',
    editedAt: new Date('2026-01-03T00:00:00Z'),
    editedBy: 'c@orono.k12.mn.us',
  };
  const identity = (html: string) => html;
  function noopRestore() {
    // Restore isn't exercised by these preview-stability tests.
  }

  function clickNthPreviewButton(n: number) {
    const buttons = screen.getAllByRole('button', { name: /^preview$/i });
    const button = buttons[n];
    if (!button) throw new Error(`Expected a Preview button at index ${String(n)}`);
    fireEvent.click(button);
  }

  it('keeps previewing the same version by identity after a concurrent save shifts array positions', () => {
    const { rerender } = render(
      <TemplateHistoryPanel
        history={[entryA, entryB]}
        substitutePreview={identity}
        onRestore={noopRestore}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /version history/i }));
    // entryB is the second row (index 1) — open its preview.
    clickNthPreviewButton(1);
    expect(screen.getByTitle(`Version preview ${historyEntryKey(entryB)}`)).toBeInTheDocument();

    // A concurrent save prepends entryC. entryA and entryB both shift down
    // one position — entryB, previously at index 1, is now at index 2.
    rerender(
      <TemplateHistoryPanel
        history={[entryC, entryA, entryB]}
        substitutePreview={identity}
        onRestore={noopRestore}
      />,
    );

    // Still entryB's content previewed (found by stable key), never
    // silently swapped to whatever now occupies the old index 1 (entryA).
    expect(screen.getByTitle(`Version preview ${historyEntryKey(entryB)}`)).toBeInTheDocument();
    expect(
      screen.queryByTitle(`Version preview ${historyEntryKey(entryA)}`),
    ).not.toBeInTheDocument();
  });

  it('closes the preview (rather than showing wrong content) when the previewed entry falls off the history array', () => {
    const { rerender } = render(
      <TemplateHistoryPanel
        history={[entryA, entryB]}
        substitutePreview={identity}
        onRestore={noopRestore}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /version history/i }));
    clickNthPreviewButton(1); // preview entryB
    expect(screen.getByTitle(`Version preview ${historyEntryKey(entryB)}`)).toBeInTheDocument();

    // entryB has fallen off the (capped) history array entirely.
    rerender(
      <TemplateHistoryPanel
        history={[entryC, entryA]}
        substitutePreview={identity}
        onRestore={noopRestore}
      />,
    );

    expect(screen.queryByTitle(/version preview/i)).not.toBeInTheDocument();
  });
});
