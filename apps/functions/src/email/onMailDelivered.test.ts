import { describe, expect, it } from 'vitest';
import type { MailDelivery } from './onMailDelivered.js';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const { isNewDeliveryError } = await import('./onMailDelivered.js');

type DeliveryState = MailDelivery['state'];

/** Build a mail doc with a delivery sub-object. */
function mailDocWithState(state: DeliveryState) {
  return {
    to: 'teacher@orono.k12.mn.us',
    message: { subject: 'Test subject' },
    delivery: { state } as MailDelivery,
  };
}

/** Build a mail doc with no delivery sub-object (just queued, not yet picked up). */
function mailDocNoDelivery() {
  return {
    to: 'teacher@orono.k12.mn.us',
    message: { subject: 'Test subject' },
  };
}

describe('isNewDeliveryError', () => {
  it('returns true when after is ERROR and before had no delivery', () => {
    expect(isNewDeliveryError(mailDocNoDelivery(), mailDocWithState('ERROR'))).toBe(true);
  });

  it('returns true when after is ERROR and before was PROCESSING', () => {
    expect(isNewDeliveryError(mailDocWithState('PROCESSING'), mailDocWithState('ERROR'))).toBe(
      true,
    );
  });

  it('returns true when after is ERROR and before was RETRY', () => {
    expect(isNewDeliveryError(mailDocWithState('RETRY'), mailDocWithState('ERROR'))).toBe(true);
  });

  it('returns true when before doc did not exist (null)', () => {
    expect(isNewDeliveryError(null, mailDocWithState('ERROR'))).toBe(true);
  });

  it('returns false when after is still ERROR and before was already ERROR (no state change)', () => {
    expect(isNewDeliveryError(mailDocWithState('ERROR'), mailDocWithState('ERROR'))).toBe(false);
  });

  it('returns false when after is SUCCESS', () => {
    expect(isNewDeliveryError(mailDocWithState('PROCESSING'), mailDocWithState('SUCCESS'))).toBe(
      false,
    );
  });

  it('returns false when after is PROCESSING', () => {
    expect(isNewDeliveryError(mailDocWithState('PENDING'), mailDocWithState('PROCESSING'))).toBe(
      false,
    );
  });

  it('returns false when after is PENDING', () => {
    expect(isNewDeliveryError(null, mailDocWithState('PENDING'))).toBe(false);
  });

  it('returns false when after doc does not exist (null)', () => {
    expect(isNewDeliveryError(mailDocWithState('ERROR'), null)).toBe(false);
  });

  it('returns false when after has no delivery sub-object', () => {
    expect(isNewDeliveryError(null, mailDocNoDelivery())).toBe(false);
  });

  it('returns false when after is RETRY (not yet final failure)', () => {
    expect(isNewDeliveryError(mailDocWithState('PROCESSING'), mailDocWithState('RETRY'))).toBe(
      false,
    );
  });
});
