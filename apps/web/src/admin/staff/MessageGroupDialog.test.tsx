/**
 * MessageGroupDialog — confirm-step regression tests.
 *
 * The dialog's body and footer used to be driven by two different conditions
 * (`step === 'confirm' && selectedTemplate` for the body, `step === 'confirm'`
 * for the footer). When the selected template disappeared from the live
 * template list while the user sat on the confirm screen — deactivated or
 * deleted by another admin — the body fell back to the compose form while the
 * footer still rendered a Send button whose handler returned early, so clicking
 * it did nothing at all and gave no feedback.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMAIL_PREFERENCES, type EmailTemplate, type Staff } from '@ops/shared';
import type { UseFirestoreCollectionResult } from '@/hooks/useFirestoreCollection';

const { templatesHolder, mockCallable } = vi.hoisted(() => ({
  templatesHolder: { current: [] as (EmailTemplate & { id: string })[] },
  mockCallable: vi.fn(() =>
    Promise.resolve({ data: { requested: 1, sent: 1, suppressed: [] as string[] } }),
  ),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (): UseFirestoreCollectionResult<EmailTemplate> => ({
    data: templatesHolder.current,
    loading: false,
    error: null,
  }),
}));

import { MessageGroupDialog, resolveMessageGroupView } from './MessageGroupDialog';

function makeTemplate(id: string, name: string): EmailTemplate & { id: string } {
  return {
    id,
    templateId: id,
    name,
    description: '',
    subject: 'Hello',
    bodyHtml: '<p>Hello</p>',
    variables: [],
    triggerType: 'manual',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeStaff(email: string): Staff & { id: string } {
  return {
    id: email,
    email,
    name: 'Teacher',
    role: 'teacher',
    year: 1,
    buildings: [],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    emailPreferences: DEFAULT_EMAIL_PREFERENCES,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function renderDialog() {
  return render(
    <MessageGroupDialog
      open
      onOpenChange={vi.fn()}
      selectedRows={[makeStaff('teacher@orono.k12.mn.us')]}
      onSent={vi.fn()}
    />,
  );
}

/** Advance the dialog from compose to the confirm screen. */
async function goToConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Template'), 'group-message');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('MessageGroupDialog — confirm step', () => {
  beforeEach(() => {
    mockCallable.mockClear();
    templatesHolder.current = [makeTemplate('group-message', 'Group message')];
  });

  it('sends the selected template from the confirm screen', async () => {
    const user = userEvent.setup();
    renderDialog();
    await goToConfirm(user);

    expect(screen.getByText(/Send “Group message” to 1 staff member/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send to 1' }));

    expect(mockCallable).toHaveBeenCalledWith({
      templateId: 'group-message',
      toEmails: ['teacher@orono.k12.mn.us'],
    });
  });

  it('replaces Send with an explicit error when the template vanishes mid-confirm', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();
    await goToConfirm(user);

    // Another admin deactivates/deletes the template; the live query updates.
    templatesHolder.current = [];
    rerender(
      <MessageGroupDialog
        open
        onOpenChange={vi.fn()}
        selectedRows={[makeStaff('teacher@orono.k12.mn.us')]}
        onSent={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('This template is no longer available.');
    // The pre-fix dialog still rendered a Send button here, and clicking it
    // silently did nothing.
    expect(screen.queryByRole('button', { name: /^Send to/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('returns to compose from the template-missing state', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();
    await goToConfirm(user);

    templatesHolder.current = [makeTemplate('other-message', 'Other message')];
    rerender(
      <MessageGroupDialog
        open
        onOpenChange={vi.fn()}
        selectedRows={[makeStaff('teacher@orono.k12.mn.us')]}
        onSent={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Template')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('resolveMessageGroupView', () => {
  const template = makeTemplate('group-message', 'Group message');
  const result = { requested: 2, sent: 2, suppressed: [] };

  it('shows the result once a broadcast has returned, whatever the step', () => {
    expect(
      resolveMessageGroupView({ result, step: 'confirm', selectedTemplate: template }),
    ).toEqual({ kind: 'result', result });
  });

  it('shows compose before the user confirms', () => {
    expect(
      resolveMessageGroupView({ result: null, step: 'compose', selectedTemplate: template }),
    ).toEqual({ kind: 'compose' });
  });

  it('carries the template into the confirm state', () => {
    expect(
      resolveMessageGroupView({ result: null, step: 'confirm', selectedTemplate: template }),
    ).toEqual({ kind: 'confirm', template });
  });

  it('falls into the explicit missing state, never confirm, without a template', () => {
    expect(
      resolveMessageGroupView({ result: null, step: 'confirm', selectedTemplate: null }),
    ).toEqual({ kind: 'template-missing' });
  });
});
