import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  processRoleYearMappingUpdate,
  roleYearMappingMailDocId,
  type ProcessRoleYearMappingDeps,
} from './onRoleYearMappingWritten.js';

type SendArgs = Parameters<ProcessRoleYearMappingDeps['send']>[0];

interface StaffFilter {
  field: string;
  op: string;
  value: unknown;
}

interface FakeStaffDoc {
  id: string;
  data: Record<string, unknown>;
}

interface FakeQuery {
  where: (field: string, op: string, value: unknown) => FakeQuery;
  get: () => Promise<{
    empty: boolean;
    size: number;
    docs: { id: string; data: () => Record<string, unknown> }[];
  }>;
}

/**
 * Minimal Firestore stub: serves a canned role doc, and staff docs keyed by
 * the value the staff query filters `role` on. Records every executed staff
 * query's filter list so tests can assert the query shape.
 */
function fakeDb(opts: {
  /** Role doc served for any roles/{id} get; null = missing doc. */
  role: { displayName: string } | null;
  /** Staff docs keyed by the `role` filter value that should match them. */
  staffByRoleValue?: Record<string, FakeStaffDoc[]>;
}): { db: Firestore; staffQueries: StaffFilter[][] } {
  const staffQueries: StaffFilter[][] = [];
  const staffByRoleValue = opts.staffByRoleValue ?? {};

  function staffQuery(filters: StaffFilter[]): FakeQuery {
    return {
      where: (field, op, value) => staffQuery([...filters, { field, op, value }]),
      get: () => {
        staffQueries.push(filters);
        const roleValue = filters.find((f) => f.field === 'role')?.value;
        const docs = typeof roleValue === 'string' ? (staffByRoleValue[roleValue] ?? []) : [];
        return Promise.resolve({
          empty: docs.length === 0,
          size: docs.length,
          docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        });
      },
    };
  }

  const db = {
    collection: (name: string) =>
      name === 'roles'
        ? {
            doc: () => ({
              get: () =>
                Promise.resolve({
                  exists: opts.role !== null,
                  data: () => opts.role ?? undefined,
                }),
            }),
          }
        : staffQuery([]),
  } as unknown as Firestore;

  return { db, staffQueries };
}

function captureSend(): { sent: SendArgs[]; send: ProcessRoleYearMappingDeps['send'] } {
  const sent: SendArgs[] = [];
  return {
    sent,
    send: (args) => {
      sent.push(args);
      return Promise.resolve(true);
    },
  };
}

const MAPPING = { roleId: 'peer-evaluator', year: 2, assignedComponentIds: ['1a', '2b'] };

const JANE: FakeStaffDoc = {
  id: 'jane@orono.k12.mn.us',
  data: { name: 'Jane Doe', role: 'peer-evaluator', year: 2, isActive: true },
};

describe('roleYearMappingMailDocId', () => {
  it('embeds the mapping id, a doc-id-safe email, and the timestamp', () => {
    expect(roleYearMappingMailDocId('pe-2', 'jane@orono.k12.mn.us', 1_700_000_000_000)).toBe(
      'subdomains-pe-2-jane-at-orono.k12.mn.us-1700000000000',
    );
  });

  it('differs across sends so a re-assignment re-sends', () => {
    expect(roleYearMappingMailDocId('pe-2', 'jane@orono.k12.mn.us', 1)).not.toBe(
      roleYearMappingMailDocId('pe-2', 'jane@orono.k12.mn.us', 2),
    );
  });
});

describe('processRoleYearMappingUpdate', () => {
  it('queries staff by role slug (staff.role stores the slug, not the displayName)', async () => {
    const { db, staffQueries } = fakeDb({
      role: { displayName: 'Peer Evaluator' },
      staffByRoleValue: { 'peer-evaluator': [JANE] },
    });
    const { sent, send } = captureSend();

    await processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 1_000 });

    expect(staffQueries).toEqual([
      [
        { field: 'role', op: '==', value: 'peer-evaluator' },
        { field: 'year', op: '==', value: 2 },
        { field: 'isActive', op: '==', value: true },
      ],
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('jane@orono.k12.mn.us');
    expect(sent[0]?.triggerType).toBe('roleYearMapping.updated');
    expect(sent[0]?.vars['staffName']).toBe('Jane Doe');
    expect(sent[0]?.vars['staffRole']).toBe('Peer Evaluator');
    expect(sent[0]?.vars['staffYear']).toBe('2');
    expect(sent[0]?.vars['assignedComponentCount']).toBe('2');
    expect(sent[0]?.vars['assignedDomainList']).toBe('2 components assigned');
  });

  it('falls back to the displayName for staff docs the slug migration missed', async () => {
    const { db, staffQueries } = fakeDb({
      role: { displayName: 'Peer Evaluator' },
      staffByRoleValue: { 'Peer Evaluator': [JANE] },
    });
    const { sent, send } = captureSend();

    await processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 1_000 });

    expect(staffQueries).toHaveLength(2);
    expect(staffQueries[1]?.[0]).toEqual({ field: 'role', op: '==', value: 'Peer Evaluator' });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('jane@orono.k12.mn.us');
  });

  it('keys each send uniquely so a second update to the same mapping re-sends', async () => {
    const { db } = fakeDb({
      role: { displayName: 'Peer Evaluator' },
      staffByRoleValue: { 'peer-evaluator': [JANE] },
    });
    const { sent, send } = captureSend();

    await processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 1_000 });
    await processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 2_000 });

    expect(sent).toHaveLength(2);
    expect(sent[0]?.mailDocId).toBe('subdomains-pe-2-jane-at-orono.k12.mn.us-1000');
    expect(sent[1]?.mailDocId).toBe('subdomains-pe-2-jane-at-orono.k12.mn.us-2000');
    expect(sent[0]?.mailDocId).not.toBe(sent[1]?.mailDocId);
  });

  it('sends nothing when the role doc is missing', async () => {
    const { db, staffQueries } = fakeDb({ role: null });
    const { sent, send } = captureSend();

    await processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 1_000 });

    expect(staffQueries).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing when no staff match the role/year', async () => {
    const { db, staffQueries } = fakeDb({ role: { displayName: 'Peer Evaluator' } });
    const { sent, send } = captureSend();

    await processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 1_000 });

    expect(staffQueries).toHaveLength(2); // slug query + displayName fallback
    expect(sent).toHaveLength(0);
  });

  it('reports "No components assigned" when the assignment list is empty', async () => {
    const { db } = fakeDb({
      role: { displayName: 'Peer Evaluator' },
      staffByRoleValue: { 'peer-evaluator': [JANE] },
    });
    const { sent, send } = captureSend();

    await processRoleYearMappingUpdate(
      'pe-2',
      { ...MAPPING, assignedComponentIds: [] },
      { db, send, now: () => 1_000 },
    );

    expect(sent[0]?.vars['assignedComponentCount']).toBe('0');
    expect(sent[0]?.vars['assignedDomainList']).toBe('No components assigned');
  });

  it('keeps sending to the rest when one send fails', async () => {
    const sam: FakeStaffDoc = { id: 'sam@orono.k12.mn.us', data: { name: 'Sam Roe' } };
    const { db } = fakeDb({
      role: { displayName: 'Peer Evaluator' },
      staffByRoleValue: { 'peer-evaluator': [JANE, sam] },
    });
    const attempted: (string | string[])[] = [];
    const send: ProcessRoleYearMappingDeps['send'] = (args) => {
      attempted.push(args.to);
      return args.to === JANE.id ? Promise.reject(new Error('boom')) : Promise.resolve(true);
    };

    await expect(
      processRoleYearMappingUpdate('pe-2', { ...MAPPING }, { db, send, now: () => 1_000 }),
    ).resolves.toBeUndefined();
    expect(attempted).toEqual([JANE.id, 'sam@orono.k12.mn.us']);
  });
});
