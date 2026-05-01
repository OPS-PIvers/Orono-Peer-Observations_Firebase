import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useHydratedDraft } from './useHydratedDraft';

interface Doc {
  id: string;
  text: string;
}

describe('useHydratedDraft', () => {
  it('hydrates once when the source first arrives', () => {
    const hydrate = vi.fn<(src: Doc) => void>();
    const { rerender } = renderHook(
      ({ id, source }: { id: string | null; source: Doc | null }) =>
        useHydratedDraft(id, source, hydrate),
      { initialProps: { id: 'doc-1', source: null as Doc | null } },
    );

    expect(hydrate).not.toHaveBeenCalled();

    rerender({ id: 'doc-1', source: { id: 'doc-1', text: 'server-initial' } });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenLastCalledWith({ id: 'doc-1', text: 'server-initial' });
  });

  it('ignores subsequent snapshots for the same id (the issue #3 race)', () => {
    const hydrate = vi.fn<(src: Doc) => void>();
    const { rerender } = renderHook(
      ({ id, source }: { id: string; source: Doc }) => useHydratedDraft(id, source, hydrate),
      { initialProps: { id: 'doc-1', source: { id: 'doc-1', text: 'server-v1' } } },
    );

    expect(hydrate).toHaveBeenCalledTimes(1);

    // Simulate Firestore firing a snapshot for the user's own write — same
    // doc id, new content reference. Must NOT clobber local state.
    rerender({ id: 'doc-1', source: { id: 'doc-1', text: 'server-v2' } });
    rerender({ id: 'doc-1', source: { id: 'doc-1', text: 'server-v3' } });

    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('rehydrates when the id changes (e.g. URL navigation)', () => {
    const hydrate = vi.fn<(src: Doc) => void>();
    const { rerender } = renderHook(
      ({ id, source }: { id: string; source: Doc }) => useHydratedDraft(id, source, hydrate),
      { initialProps: { id: 'doc-1', source: { id: 'doc-1', text: 'one' } } },
    );

    expect(hydrate).toHaveBeenCalledTimes(1);

    rerender({ id: 'doc-2', source: { id: 'doc-2', text: 'two' } });
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenLastCalledWith({ id: 'doc-2', text: 'two' });
  });

  it('still hydrates if the source is null on first render and arrives later', () => {
    const hydrate = vi.fn<(src: Doc) => void>();
    const { rerender } = renderHook(
      ({ id, source }: { id: string; source: Doc | null }) => useHydratedDraft(id, source, hydrate),
      { initialProps: { id: 'doc-1', source: null as Doc | null } },
    );

    expect(hydrate).not.toHaveBeenCalled();

    rerender({ id: 'doc-1', source: { id: 'doc-1', text: 'late' } });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('does not hydrate while id is missing, then hydrates when id arrives', () => {
    const hydrate = vi.fn<(src: Doc) => void>();
    const { rerender } = renderHook(
      ({ id, source }: { id: string | null; source: Doc | null }) =>
        useHydratedDraft(id, source, hydrate),
      { initialProps: { id: null as string | null, source: { id: 'doc-1', text: 'present' } } },
    );

    expect(hydrate).not.toHaveBeenCalled();

    rerender({ id: 'doc-1', source: { id: 'doc-1', text: 'present' } });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('preserves in-progress edits when a stale snapshot fires (issue #3 scenario)', async () => {
    // Mirrors ObservationEditorPage's exact pattern: useFirestoreDoc gives
    // us a `source`; we keep both a state copy (`draft`) and a ref copy
    // (`draftRef`) hydrated from it; the user types into a controlled
    // input, and the parent re-pushes a snapshot reflecting the user's
    // *previous* keystroke (the latency-compensated read-back).
    function Editor({ source }: { source: { id: string; text: string } | null }) {
      const [draft, setDraft] = useState<string>('');
      const draftRef = useRef<string>('');
      useHydratedDraft(source?.id ?? null, source, (src) => {
        setDraft(src.text);
        draftRef.current = src.text;
      });
      return (
        <input
          aria-label="notes"
          value={draft}
          onChange={(e) => {
            draftRef.current = e.target.value;
            setDraft(e.target.value);
          }}
        />
      );
    }

    const user = userEvent.setup();
    const { rerender } = render(<Editor source={{ id: 'obs-1', text: 'hello' }} />);
    const input = screen.getByLabelText('notes');
    expect(input).toHaveValue('hello');

    await user.type(input, ' world');
    expect(input).toHaveValue('hello world');

    // A snapshot from Firestore arrives reflecting the prior server state
    // ("hello"). Before the fix this would clobber the input. After the
    // fix, the hook ignores it — the user's "hello world" must persist.
    rerender(<Editor source={{ id: 'obs-1', text: 'hello' }} />);
    expect(input).toHaveValue('hello world');

    // A snapshot containing the user's just-saved content arrives. Same
    // id, so still ignored.
    rerender(<Editor source={{ id: 'obs-1', text: 'hello world' }} />);
    expect(input).toHaveValue('hello world');

    // User types more, then ANOTHER snapshot arrives (the second ack
    // Firestore fires once the server confirms). Still must not clobber.
    await user.type(input, '!');
    expect(input).toHaveValue('hello world!');
    rerender(<Editor source={{ id: 'obs-1', text: 'hello world' }} />);
    expect(input).toHaveValue('hello world!');
  });

  it('runs the latest hydrate closure when the id changes', () => {
    const first = vi.fn<(src: Doc) => void>();
    const second = vi.fn<(src: Doc) => void>();

    interface Props {
      id: string;
      source: Doc;
      hydrate: (src: Doc) => void;
    }

    const { rerender } = renderHook(
      ({ id, source, hydrate }: Props) => useHydratedDraft(id, source, hydrate),
      { initialProps: { id: 'doc-1', source: { id: 'doc-1', text: 'a' }, hydrate: first } },
    );

    expect(first).toHaveBeenCalledTimes(1);

    // New hydrate reference + new source — same id should NOT re-hydrate.
    rerender({ id: 'doc-1', source: { id: 'doc-1', text: 'b' }, hydrate: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    // Id change uses the latest hydrate closure.
    rerender({ id: 'doc-2', source: { id: 'doc-2', text: 'c' }, hydrate: second });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith({ id: 'doc-2', text: 'c' });
  });
});
