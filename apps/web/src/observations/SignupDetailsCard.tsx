import { Calendar } from 'lucide-react';
import type { SignupFieldAnswer } from '@ops/shared';
import { formatLocalDateTime, formatLocalTime, toDate } from '@/scheduling/slotTime';

interface SignupDetailsCardProps {
  /** Scheduled start (Firestore Timestamp, Date, or ISO string). */
  scheduledStartAt: unknown;
  /** Scheduled end (Firestore Timestamp, Date, or ISO string). */
  scheduledEndAt: unknown;
  /** Sign-up field answers captured at booking. */
  signupDetails: SignupFieldAnswer[];
}

/**
 * Read-only card shown in the ObservationEditorPage when the observation was
 * created from a booked slot. Displays the scheduled time window (formatted in
 * America/Chicago) and the staff member's sign-up Q&A answers.
 *
 * Designed to sit between the page header and the meeting-notes section so the
 * PE can see the booking context before diving into the rubric.
 */
export function SignupDetailsCard({
  scheduledStartAt,
  scheduledEndAt,
  signupDetails,
}: SignupDetailsCardProps) {
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

  const hasAnswers = signupDetails.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="bg-ops-blue-dark flex items-center gap-3 px-5 py-3.5">
        <Calendar className="h-5 w-5 shrink-0 text-white" aria-hidden="true" />
        <h2 className="font-heading text-sm font-semibold text-white">Booking Details</h2>
      </div>

      <div className="space-y-3 px-5 py-4">
        <div className="flex items-start gap-2">
          <span className="text-ops-gray w-32 shrink-0 text-sm font-medium">Scheduled time</span>
          <span className="text-sm">{timeLabel}</span>
        </div>

        {hasAnswers ? (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-ops-gray-dark mb-2 text-sm font-semibold">Sign-up details</p>
            <dl className="space-y-2">
              {signupDetails.map((answer) => (
                <div key={answer.fieldId} className="flex items-start gap-2">
                  <dt className="text-ops-gray w-32 shrink-0 text-sm font-medium capitalize">
                    {answer.fieldId.replace(/-/g, ' ')}
                  </dt>
                  <dd className="text-sm">{answer.value || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </div>
  );
}
