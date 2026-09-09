import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EMAIL_PREFERENCES,
  emptyAudience,
  type Building,
  type DashboardMaterialAudience,
  type DashboardQuickMaterial,
  type ModuleDoc,
  type Role,
  type Staff,
} from '@ops/shared';
import { AudiencePicker } from './AudiencePicker';
import { QuickMaterialsEditor } from './QuickMaterialsEditor';
import { summarizeAudience, type AudienceOptions } from './audienceOptions';

/**
 * The "Visible to" control: collapsed by default (one line, no picker in
 * the DOM), expands in place, renders stored ids back into words, flags
 * stale chips, and reports a live match count against the roster.
 */

const now = new Date('2026-03-01T00:00:00Z');

const OPTIONS: AudienceOptions = {
  roles: [
    { roleId: 'teacher', displayName: 'Teacher', rubricId: 'teacher', isActive: true } as Role,
    {
      roleId: 'counselor',
      displayName: 'Counselor',
      rubricId: 'counselor',
      isActive: true,
    } as Role,
  ],
  buildings: [
    { buildingId: 'oms', displayName: 'OMS', isActive: true, createdAt: now, updatedAt: now },
    {
      buildingId: 'high-school',
      displayName: 'High School',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ] as Building[],
  modules: [
    { moduleId: 'mentor', displayName: 'Mentor', isActive: true, autoEnable: null } as ModuleDoc,
  ],
};

function staff(partial: Partial<Staff>): Staff {
  return {
    email: `${partial.name ?? 'x'}@orono.k12.mn.us`.toLowerCase(),
    name: 'X',
    role: 'teacher',
    year: 1,
    buildings: ['High School'],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    emailPreferences: DEFAULT_EMAIL_PREFERENCES,
    lastSignInAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

const ROSTER: Staff[] = [
  staff({ name: 'a', year: 1, buildings: ['OMS'] }),
  staff({ name: 'b', year: 2, buildings: ['OMS'] }),
  staff({ name: 'c', year: 1, buildings: ['High School'] }),
  staff({ name: 'd', year: 1, buildings: ['OMS'], isActive: false }),
];

function material(audience: DashboardMaterialAudience): DashboardQuickMaterial {
  return { label: 'Rubric', sub: '', icon: 'doc', url: '', audience };
}

describe('summarizeAudience', () => {
  it('says Everyone for an empty rule', () => {
    expect(summarizeAudience(emptyAudience(), OPTIONS)).toBe('Everyone');
  });

  it('joins dimensions with a middle dot and renders ids as names', () => {
    expect(
      summarizeAudience(
        { ...emptyAudience(), years: [2, 1, 4], buildings: ['OMS'], roles: ['counselor'] },
        OPTIONS,
      ),
    ).toBe('Year 1, Year 2, P1 · OMS · Counselor');
  });
});

describe('AudiencePicker', () => {
  it('is one collapsed line at rest and expands in place', async () => {
    const user = userEvent.setup();
    render(
      <AudiencePicker
        value={emptyAudience()}
        onChange={() => undefined}
        options={OPTIONS}
        matchCount={{ matched: 3, total: 3 }}
        stale={{ buildings: [], roles: [], modules: [] }}
      />,
    );
    expect(screen.getByText('Everyone')).toBeInTheDocument();
    expect(screen.queryByTestId('audience-picker')).toBeNull();

    await user.click(screen.getByRole('button', { name: /visible to/i }));
    expect(screen.getByTestId('audience-picker')).toBeInTheDocument();
    expect(screen.getByTestId('audience-match-count')).toHaveTextContent('Matches 3 of 3 staff');

    await user.click(screen.getByRole('button', { name: /done choosing/i }));
    expect(screen.queryByTestId('audience-picker')).toBeNull();
  });

  it('toggles a chip through the dropdown and can clear back to everyone', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AudiencePicker
        value={{ ...emptyAudience(), buildings: ['OMS'] }}
        onChange={onChange}
        options={OPTIONS}
        matchCount={{ matched: 2, total: 3 }}
        stale={{ buildings: [], roles: [], modules: [] }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /visible to/i }));
    await user.click(screen.getByRole('button', { name: /^Building/ }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'High School' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAudience(),
      buildings: ['OMS', 'High School'],
    });

    // Close the menu first: while it is open Radix makes the rest of the
    // page inert, and the buttons underneath are not reachable.
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /show to everyone/i }));
    expect(onChange).toHaveBeenLastCalledWith(emptyAudience());
  });

  it('flags stale chips on the collapsed line and lists them when open', async () => {
    const user = userEvent.setup();
    render(
      <AudiencePicker
        value={{ ...emptyAudience(), buildings: ['Old Name'] }}
        onChange={() => undefined}
        options={OPTIONS}
        matchCount={{ matched: 3, total: 3 }}
        stale={{ buildings: ['Old Name'], roles: [], modules: [] }}
      />,
    );
    expect(screen.getByLabelText(/no longer exist/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /visible to/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Old Name');
  });

  it('calls out a rule that matches nobody', async () => {
    const user = userEvent.setup();
    render(
      <AudiencePicker
        value={{ ...emptyAudience(), roles: ['counselor'] }}
        onChange={() => undefined}
        options={OPTIONS}
        matchCount={{ matched: 0, total: 3 }}
        stale={{ buildings: [], roles: [], modules: [] }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /visible to/i }));
    expect(screen.getByTestId('audience-match-count')).toHaveTextContent(/nobody matches/i);
  });
});

describe('QuickMaterialsEditor audience integration', () => {
  it('counts active roster matches per card with AND-across semantics', async () => {
    const user = userEvent.setup();
    render(
      <QuickMaterialsEditor
        value={[material({ ...emptyAudience(), years: [1], buildings: ['OMS'] })]}
        onChange={() => undefined}
        audienceOptions={OPTIONS}
        staffRoster={ROSTER}
      />,
    );
    expect(screen.getByText('Year 1 · OMS')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /visible to/i }));
    // a matches (year 1 at OMS); b is year 2; c is at HS; d is archived.
    expect(screen.getByTestId('audience-match-count')).toHaveTextContent('Matches 1 of 3 staff');
  });

  it('adds new cards with an empty audience and writes audience edits back', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuickMaterialsEditor
        value={[]}
        onChange={onChange}
        audienceOptions={OPTIONS}
        staffRoster={ROSTER}
      />,
    );
    await user.click(screen.getByRole('button', { name: /add link/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      { label: '', sub: '', icon: 'doc', url: '', audience: emptyAudience() },
    ]);
  });
});
