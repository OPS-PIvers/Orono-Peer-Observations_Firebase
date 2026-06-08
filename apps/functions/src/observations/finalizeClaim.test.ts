import { describe, expect, it } from 'vitest';
import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { claimObservationForFinalize, type FinalizeClaimTx } from './finalizeClaim.js';

/**
 * A tiny in-memory observation + fake transaction. Firestore serializes
 * concurrent transactions, so running two claims sequentially against the
 * same store models the double-finalize race: the second claim must observe
 * the first claim's write.
 */
interface Store {
  data: Record<string, unknown> | null;
}

const REF = {} as unknown as DocumentReference;

function fakeTx(store: Store): FinalizeClaimTx {
  return {
    get: () =>
      Promise.resolve({
        exists: store.data !== null,
        id: 'obs1',
        data: () => store.data ?? undefined,
      } as unknown as DocumentSnapshot),
    update: (_ref, patch) => {
      store.data = { ...(store.data ?? {}), ...patch };
    },
  };
}

const draft = (over: Record<string, unknown> = {}): Store => ({
  data: { observerEmail: 'pe@orono.k12.mn.us', status: 'Draft', ...over },
});

describe('claimObservationForFinalize', () => {
  it('claims a Draft (flips to Finalized) and returns the pre-update data', async () => {
    const store = draft();
    const result = await claimObservationForFinalize(fakeTx(store), REF, {
      userEmail: 'pe@orono.k12.mn.us',
      isAdmin: false,
    });
    expect(result.status).toBe('Draft'); // pre-update snapshot
    expect(store.data?.['status']).toBe('Finalized'); // store now claimed
  });

  it('lets the second concurrent caller abort once the first has claimed', async () => {
    const store = draft();
    const opts = { userEmail: 'pe@orono.k12.mn.us', isAdmin: false };
    await claimObservationForFinalize(fakeTx(store), REF, opts);
    await expect(claimObservationForFinalize(fakeTx(store), REF, opts)).rejects.toThrow(
      /already finalized/i,
    );
  });

  it('rejects a caller who is neither the observer nor an admin', async () => {
    const store = draft();
    await expect(
      claimObservationForFinalize(fakeTx(store), REF, {
        userEmail: 'other@orono.k12.mn.us',
        isAdmin: false,
      }),
    ).rejects.toThrow(/observer or an admin/i);
    expect(store.data?.['status']).toBe('Draft'); // unchanged
  });

  it('allows an admin who is not the observer to claim', async () => {
    const store = draft();
    await claimObservationForFinalize(fakeTx(store), REF, {
      userEmail: 'admin@orono.k12.mn.us',
      isAdmin: true,
    });
    expect(store.data?.['status']).toBe('Finalized');
  });

  it('throws when the observation does not exist', async () => {
    const store: Store = { data: null };
    await expect(
      claimObservationForFinalize(fakeTx(store), REF, {
        userEmail: 'pe@orono.k12.mn.us',
        isAdmin: false,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
