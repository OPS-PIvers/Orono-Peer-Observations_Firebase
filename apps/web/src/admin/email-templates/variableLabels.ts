import type { TemplateVariable } from '@ops/shared';

/**
 * Plain-English labels for each template variable, shown on the insert chips
 * and on the in-editor pills. The stored token stays `{{<key>}}` — these
 * labels are display-only and never change what's persisted or sent.
 */
export const VARIABLE_LABELS: Record<TemplateVariable, string> = {
  observerName: "Peer evaluator's name",
  observerEmail: "Peer evaluator's email",
  observedName: "Staff member's name",
  observedEmail: "Staff member's email",
  observedRole: "Staff member's role",
  observedYear: "Staff member's year",
  observationDate: 'Observation date',
  observationName: 'Observation name',
  observationType: 'Observation type',
  pdfDriveLink: 'PDF report link',
  driveFolderLink: 'Drive folder link',
  appName: 'App name',
  signInLink: 'Sign-in link',
  staffName: "Staff member's name",
  staffEmail: "Staff member's email",
  staffRole: "Staff member's role",
  assignedDomainList: 'Assigned components list',
  assignedComponentCount: 'Assigned component count',
  signupLink: 'Sign-up link',
  bookingLink: 'Booking link',
  slotDateLocal: 'Slot date',
  slotStartLocal: 'Slot start time',
  slotEndLocal: 'Slot end time',
  slotPeriodName: 'Class period',
  buildingName: 'Building name',
  cancellationReason: 'Cancellation reason',
  windowStartLocal: 'Window start date',
  windowEndLocal: 'Window end date',
};

/** Friendly label for a variable key, falling back to the raw key. */
export function variableLabel(name: string): string {
  return (VARIABLE_LABELS as Record<string, string>)[name] ?? name;
}
