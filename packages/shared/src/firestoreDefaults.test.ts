import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { applySchemaDefaults, hydrateFirestoreDoc, schemaForPath } from './firestoreDefaults.js';
import { APP_SETTINGS_DOC_ID, appSettings } from './schema/settings.js';
import { DASHBOARD_CONFIG_DOC_ID, dashboardConfig } from './schema/dashboard.js';
import { observationSlot } from './schema/observationSlot.js';
import { rubric } from './schema/rubric.js';
import { moduleProgress } from './schema/moduleItem.js';
import { staff } from './schema/staff.js';

describe('applySchemaDefaults', () => {
  it('fills a missing key from its schema default', () => {
    const schema = z.object({ a: z.string().default('A'), b: z.string() });
    expect(applySchemaDefaults(schema, { b: 'kept' })).toEqual({ a: 'A', b: 'kept' });
  });

  it('never overwrites a value that is present, including falsy ones', () => {
    const schema = z.object({ n: z.number().default(7), s: z.string().default('x') });
    expect(applySchemaDefaults(schema, { n: 0, s: '' })).toEqual({ n: 0, s: '' });
  });

  it('leaves required scalar keys absent rather than inventing a value', () => {
    const schema = z.object({ required: z.string(), opt: z.string().optional() });
    expect(applySchemaDefaults(schema, {})).toEqual({});
  });

  it('substitutes an empty container for a missing required array or object', () => {
    const schema = z.object({
      rows: z.array(z.object({ id: z.string() })),
      bag: z.object({ a: z.string() }),
    });
    expect(applySchemaDefaults(schema, {})).toEqual({ rows: [], bag: {} });
  });

  it('reports each substituted required container by path', () => {
    const schema = z.object({
      outer: z.object({ rows: z.array(z.string()) }).default({ rows: [] }),
    });
    const repairs: [string, string][] = [];
    applySchemaDefaults(schema, { outer: {} }, (field, kind) => repairs.push([field, kind]));
    expect(repairs).toEqual([['outer.rows', 'array']]);
  });

  it('does not substitute for an optional container', () => {
    const schema = z.object({ rows: z.array(z.string()).optional() });
    expect(applySchemaDefaults(schema, {})).toEqual({});
  });

  it('keeps a rubric renderable when domains are missing', () => {
    // Every rubric consumer goes straight to `rubric.domains.map(...)`.
    const filled = applySchemaDefaults<{ domains: unknown[] }>(rubric, { name: 'Legacy' });
    expect(filled.domains).toEqual([]);
  });

  it('fills a missing components array inside a present domain', () => {
    const filled = applySchemaDefaults<{ domains: { components: unknown[] }[] }>(rubric, {
      domains: [{ id: '1', name: 'Planning' }],
    });
    expect(filled.domains[0]?.components).toEqual([]);
  });

  it('preserves keys the schema does not know about', () => {
    const schema = z.object({ a: z.string().default('A') });
    expect(applySchemaDefaults(schema, { legacyField: 1 })).toEqual({ legacyField: 1, a: 'A' });
  });

  it('recurses into a nested object that is present but partial', () => {
    const schema = z.object({
      nested: z
        .object({ a: z.string().default('A'), b: z.string().default('B') })
        .default({ a: 'A', b: 'B' }),
    });
    expect(applySchemaDefaults(schema, { nested: { b: 'kept' } })).toEqual({
      nested: { a: 'A', b: 'kept' },
    });
  });

  it('recurses into object elements of an array', () => {
    const schema = z.object({
      rows: z.array(z.object({ id: z.string(), on: z.boolean().default(false) })).default([]),
    });
    expect(applySchemaDefaults(schema, { rows: [{ id: 'x' }] })).toEqual({
      rows: [{ id: 'x', on: false }],
    });
  });

  it('returns the same reference when nothing needs filling', () => {
    const schema = z.object({ a: z.string().default('A') });
    const raw = { a: 'set' };
    expect(applySchemaDefaults(schema, raw)).toBe(raw);
  });

  it('does not mutate the input document', () => {
    const schema = z.object({ a: z.string().default('A') });
    const raw: Record<string, unknown> = {};
    applySchemaDefaults(schema, raw);
    expect(raw).toEqual({});
  });

  it('hands back a fresh object default per call so callers can mutate it', () => {
    const schema = z.object({ bag: z.object({ k: z.string() }).partial().default({}) });
    const first = applySchemaDefaults<{ bag: Record<string, string> }>(schema, {});
    const second = applySchemaDefaults<{ bag: Record<string, string> }>(schema, {});
    expect(first.bag).not.toBe(second.bag);
  });

  it('passes the document through untouched when there is no schema', () => {
    const raw = { anything: true };
    expect(applySchemaDefaults(null, raw)).toBe(raw);
  });

  it('leaves non-object values alone', () => {
    const schema = z.object({ a: z.string().default('A') });
    expect(applySchemaDefaults(schema, null)).toBeNull();
    expect(applySchemaDefaults(schema, 'nope')).toBe('nope');
  });

  it('treats class instances (e.g. Firestore Timestamps) as values, not shapes', () => {
    class Timestamp {
      constructor(readonly seconds: number) {}
      toDate() {
        return new Date(this.seconds * 1000);
      }
    }
    const schema = z.object({ updatedAt: z.date() });
    const stamp = new Timestamp(1);
    const out = applySchemaDefaults<{ updatedAt: Timestamp }>(schema, { updatedAt: stamp });
    expect(out.updatedAt).toBe(stamp);
  });

  it('fills appSettings.yearColors for a doc written before the field existed', () => {
    // The crash this module exists to prevent: RoleYearMappingsPage read
    // `settings.yearColors[1]` off a document that predates yearColors.
    const legacy = { securityAdminEmail: 'admin@orono.k12.mn.us' };
    const filled = applySchemaDefaults<{ yearColors: Record<number, string> }>(appSettings, legacy);
    expect(filled.yearColors).toEqual({});
  });

  it('fills nested appSettings groups that were only partially written', () => {
    const filled = applySchemaDefaults<{
      scheduling: Record<string, unknown>;
      gemini: { audioTranscription: { enabled: boolean } };
    }>(appSettings, { scheduling: {}, gemini: {} });
    expect(filled.scheduling).not.toEqual({});
    expect(filled.gemini.audioTranscription.enabled).toBe(true);
  });
});

describe('schemaForPath', () => {
  it.each([
    ['staff', staff],
    ['staff/teacher@orono.k12.mn.us', staff],
    ['staff/teacher@orono.k12.mn.us/moduleProgress', moduleProgress],
    ['staff/teacher@orono.k12.mn.us/moduleProgress/mod-1', moduleProgress],
    ['observationWindows/win-1/slots', observationSlot],
    [`appSettings/${APP_SETTINGS_DOC_ID}`, appSettings],
    [`appSettings/${DASHBOARD_CONFIG_DOC_ID}`, dashboardConfig],
  ])('resolves %s', (path, expected) => {
    expect(schemaForPath(path)).toBe(expected);
  });

  it('returns null for unregistered and empty paths', () => {
    expect(schemaForPath('mail')).toBeNull();
    expect(schemaForPath('somethingNew/abc')).toBeNull();
    expect(schemaForPath('')).toBeNull();
  });
});

describe('hydrateFirestoreDoc', () => {
  it('applies defaults and stamps the id', () => {
    const out = hydrateFirestoreDoc<{ yearColors: Record<number, string> }>(
      `appSettings/${APP_SETTINGS_DOC_ID}`,
      { securityAdminEmail: 'admin@orono.k12.mn.us' },
      APP_SETTINGS_DOC_ID,
    );
    expect(out.id).toBe(APP_SETTINGS_DOC_ID);
    expect(out.yearColors).toEqual({});
  });

  it('still stamps the id when the path has no schema', () => {
    expect(hydrateFirestoreDoc('mail/abc', { to: 'x' }, 'abc')).toEqual({ to: 'x', id: 'abc' });
  });
});
