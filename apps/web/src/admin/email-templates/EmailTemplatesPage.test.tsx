/**
 * EmailTemplatesPage — Recipient control regression tests.
 *
 * Covers the "inert admin control" finding: scheduledEmailReminders.ts
 * hardcodes the recipient for scheduled.reminderIncomplete and
 * scheduled.reminderOverdueFinalize, ignoring the template's `recipient`
 * field entirely. The admin editor must disable the Recipient selector
 * (and explain why) for those trigger types, while leaving it fully
 * editable for triggers whose send path actually branches on it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTemplate } from '@ops/shared';

const { templatesHolder } = vi.hoisted(() => ({
  templatesHolder: { current: [] as (EmailTemplate & { id: string })[] },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  deleteDoc: vi.fn(() => Promise.resolve()),
  orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
  serverTimestamp: () => 'server-timestamp',
  setDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(() => Promise.resolve({ data: { sent: true } })),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({
    appName: 'Orono Peer Observations',
    primaryColor: '#2d3f89',
    logoUrl: null,
    iconUrl: null,
  }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({
    data: templatesHolder.current,
    loading: false,
    error: null,
  }),
}));

import { EmailTemplatesPage } from './EmailTemplatesPage';

function makeTemplate(overrides: Partial<EmailTemplate & { id: string }>): EmailTemplate & {
  id: string;
} {
  return {
    id: 'tmpl-1',
    templateId: 'tmpl-1',
    name: 'Template',
    description: '',
    subject: 'Subject',
    bodyHtml: '<p>Body</p>',
    variables: [],
    triggerType: 'manual',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  templatesHolder.current = [];
});

async function openEditor() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Edit/i }));
}

describe('Recipient control — fixed-recipient triggers', () => {
  it('disables the Recipient selector for scheduled.reminderOverdueFinalize', async () => {
    templatesHolder.current = [
      makeTemplate({
        id: 'overdue',
        templateId: 'overdue',
        name: 'Overdue Finalize Reminder',
        triggerType: 'scheduled.reminderOverdueFinalize',
        recipient: 'observer',
      }),
    ];
    render(<EmailTemplatesPage />);
    await openEditor();

    const select = screen.getByLabelText('Recipient');
    expect(select).toBeDisabled();
    expect(
      screen.getByText(/Recipient is fixed for this trigger/i, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/the observing peer evaluator/i)).toBeInTheDocument();
  });

  it('disables the Recipient selector for scheduled.reminderIncomplete', async () => {
    templatesHolder.current = [
      makeTemplate({
        id: 'incomplete',
        templateId: 'incomplete',
        name: 'Incomplete Reminder',
        triggerType: 'scheduled.reminderIncomplete',
        recipient: 'observed',
      }),
    ];
    render(<EmailTemplatesPage />);
    await openEditor();

    const select = screen.getByLabelText('Recipient');
    expect(select).toBeDisabled();
    expect(screen.getByText(/the observed staff member/i)).toBeInTheDocument();
  });
});

describe('Recipient control — non-fixed triggers', () => {
  it('leaves the Recipient selector enabled for scheduled.preObservation', async () => {
    templatesHolder.current = [
      makeTemplate({
        id: 'preobs',
        templateId: 'preobs',
        name: 'Pre-Observation Reminder',
        triggerType: 'scheduled.preObservation',
        recipient: 'observed',
      }),
    ];
    render(<EmailTemplatesPage />);
    await openEditor();

    const select = screen.getByLabelText('Recipient');
    expect(select).not.toBeDisabled();
    expect(screen.queryByText(/Recipient is fixed for this trigger/i)).not.toBeInTheDocument();
  });

  it('leaves the Recipient selector enabled for manual templates', async () => {
    templatesHolder.current = [
      makeTemplate({
        id: 'manual-1',
        templateId: 'manual-1',
        name: 'Manual Template',
        triggerType: 'manual',
        recipient: 'observed',
        isSystem: false,
      }),
    ];
    render(<EmailTemplatesPage />);
    await openEditor();

    const select = screen.getByLabelText('Recipient');
    expect(select).not.toBeDisabled();
  });
});
