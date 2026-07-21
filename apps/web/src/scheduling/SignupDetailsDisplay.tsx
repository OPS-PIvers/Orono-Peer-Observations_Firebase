import type { SignupFieldAnswer } from '@ops/shared';
import { formatLocalDateTime, formatLocalTime, toDate } from './slotTime';

interface SignupDetailsDisplayProps {
  /** Scheduled start (Firestore Timestamp, Date, or ISO string). */
  scheduledStartAt: unknown;
  /** Scheduled end (Firestore Timestamp, Date, or ISO string). */
  scheduledEndAt: unknown;
  /** Sign-up field answers captured at booking. */
  signupDetails: SignupFieldAnswer[];
}

/**
 * Compact read-only view of a booking's scheduled time and sign-up answers.
 * Used inside the ObservationInfoPopover to surface booking context without
 * navigating away from the editor.
 */
export function SignupDetailsDisplay({
  scheduledStartAt,
  scheduledEndAt,
  signupDetails,
}: SignupDetailsDisplayProps) {
  const startLabel = formatLocalDateTime(scheduledStartAt);
  const endDate = toDate(scheduledEndAt);
  const endLabel = endDate
    ? endDate.toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
      })
    : formatLocalTime(scheduledEndAt);

  const timeLabel =
    startLabel && endLabel ? `${startLabel} – ${endLabel}` : startLabel ? startLabel : '—';

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <dt className="text-ops-gray w-12 shrink-0">Time</dt>
        <dd className="min-w-0 font-medium break-words">{timeLabel}</dd>
      </div>
      {signupDetails.map((answer) => (
        <div key={answer.fieldId} className="flex gap-1.5">
          <dt
            className="text-ops-gray w-12 shrink-0 truncate capitalize"
            title={answer.fieldId.replace(/-/g, ' ')}
          >
            {answer.fieldId.replace(/-/g, ' ')}
          </dt>
          <dd className="font-medium">{answer.value || '—'}</dd>
        </div>
      ))}
    </div>
  );
}
