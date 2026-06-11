import { describe, expect, it } from 'vitest';
import type { EmailTemplate } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in sendManualEmail.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { TEST_SUBJECT_PREFIX, assertTemplateSendable, buildSendSubject } =
  await import('./sendManualEmail.js');

type SendableTemplate = Pick<EmailTemplate, 'isActive' | 'triggerType'>;

const template = (over: Partial<SendableTemplate> = {}): SendableTemplate => ({
  isActive: true,
  triggerType: 'manual',
  ...over,
});

describe('assertTemplateSendable', () => {
  describe('real sends (StaffPersonPage flow)', () => {
    it('allows an active manual template for a non-admin PE', () => {
      expect(() => {
        assertTemplateSendable(template(), { isTest: false, isAdmin: false });
      }).not.toThrow();
    });

    it('rejects an automatic template even for an admin', () => {
      expect(() => {
        assertTemplateSendable(template({ triggerType: 'scheduling.bookingConfirmation' }), {
          isTest: false,
          isAdmin: true,
        });
      }).toThrow(/only manual templates/i);
    });

    it('rejects an inactive manual template', () => {
      expect(() => {
        assertTemplateSendable(template({ isActive: false }), { isTest: false, isAdmin: false });
      }).toThrow(/inactive/i);
    });
  });

  describe('test sends (admin Email Templates page)', () => {
    it('allows an admin to test-send an automatic template', () => {
      expect(() => {
        assertTemplateSendable(template({ triggerType: 'observation.finalized' }), {
          isTest: true,
          isAdmin: true,
        });
      }).not.toThrow();
    });

    it('allows an admin to test-send an inactive template', () => {
      expect(() => {
        assertTemplateSendable(template({ isActive: false }), { isTest: true, isAdmin: true });
      }).not.toThrow();
    });

    it('rejects test sends from non-admin callers', () => {
      expect(() => {
        assertTemplateSendable(template(), { isTest: true, isAdmin: false });
      }).toThrow(/only admins can send test emails/i);
    });
  });
});

describe('buildSendSubject', () => {
  it('substitutes variables without a prefix for real sends', () => {
    expect(buildSendSubject('Hello {{observedName}}', { observedName: 'Alex' }, false)).toBe(
      'Hello Alex',
    );
  });

  it('prefixes test sends with [TEST] after substitution', () => {
    expect(buildSendSubject('Hello {{observedName}}', { observedName: 'Alex' }, true)).toBe(
      `${TEST_SUBJECT_PREFIX}Hello Alex`,
    );
  });
});
