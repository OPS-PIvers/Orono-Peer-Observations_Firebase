import { useMemo } from 'react';
import {
  COLLECTIONS,
  type BookingMode,
  type BuildingSchedule,
  type SignupField,
  type SignupFieldAnswer,
} from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Label } from '@/components/ui/label';

const SELECT_CLASS =
  'border-input bg-background h-11 rounded-md border px-3 text-sm disabled:opacity-50';

/**
 * Shared "sign-up detail fields" sub-form rendered on the booking page for
 * both booking modes. Answers are keyed by `fieldId` and surfaced to the
 * parent as a controlled `Record<fieldId, value>`. The parent owns the
 * required-field gating via {@link signupFieldsComplete}.
 */
export interface SignupDetailFieldsProps {
  /** The window's selected sign-up fields (already loaded). */
  fields: SignupField[];
  /** Mode the window is in — fields whose `appliesTo` is 'both' always match. */
  mode: BookingMode;
  /** Building the invitee books against — drives the period-picker options. */
  buildingId: string;
  /** Controlled answer map: fieldId -> value. */
  answers: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}

/** Active fields whose `appliesTo` matches the mode ('both' always matches). */
export function applicableSignupFields(fields: SignupField[], mode: BookingMode): SignupField[] {
  return fields
    .filter((f) => f.isActive && (f.appliesTo === 'both' || f.appliesTo === mode))
    .sort((a, b) => a.order - b.order);
}

/** True when every required applicable field has a non-empty answer. */
export function signupFieldsComplete(
  fields: SignupField[],
  mode: BookingMode,
  answers: Record<string, string>,
): boolean {
  return applicableSignupFields(fields, mode).every(
    (f) => !f.required || (answers[f.fieldId] ?? '').trim() !== '',
  );
}

/** Build the `SignupFieldAnswer[]` payload from the controlled answer map. */
export function buildDetailAnswers(
  fields: SignupField[],
  mode: BookingMode,
  answers: Record<string, string>,
): SignupFieldAnswer[] {
  return applicableSignupFields(fields, mode)
    .map((f) => ({ fieldId: f.fieldId, type: f.type, value: (answers[f.fieldId] ?? '').trim() }))
    .filter((a) => a.value !== '');
}

export function SignupDetailFields({
  fields,
  mode,
  buildingId,
  answers,
  onChange,
}: SignupDetailFieldsProps) {
  const applicable = useMemo(() => applicableSignupFields(fields, mode), [fields, mode]);

  // Only load the building schedule when a period-picker field is present.
  const needsSchedule = applicable.some((f) => f.type === 'period-picker');
  const schedulePath = needsSchedule ? `${COLLECTIONS.buildingSchedules}/${buildingId}` : '';
  const { data: schedule } = useFirestoreDoc<BuildingSchedule>(schedulePath);

  // Distinct period names across all of the building's day types, kept in
  // first-seen order (which preserves admin-defined period ordering).
  const periodNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const dayType of schedule?.dayTypes ?? []) {
      for (const period of dayType.periods) {
        if (!seen.has(period.name)) {
          seen.add(period.name);
          names.push(period.name);
        }
      }
    }
    return names;
  }, [schedule]);

  if (applicable.length === 0) return null;

  return (
    <div className="grid gap-4">
      {applicable.map((field) => {
        const value = answers[field.fieldId] ?? '';
        const labelNode = (
          <Label htmlFor={`signup-${field.fieldId}`}>
            {field.label}
            {field.required ? <span className="text-ops-red-dark ml-1">*</span> : null}
          </Label>
        );

        if (field.type === 'before-after') {
          return (
            <div key={field.fieldId} className="grid gap-2">
              {labelNode}
              <select
                id={`signup-${field.fieldId}`}
                value={value}
                onChange={(e) => onChange(field.fieldId, e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Select…</option>
                <option value="Before school">Before school</option>
                <option value="After school">After school</option>
              </select>
            </div>
          );
        }

        if (field.type === 'period-picker') {
          return (
            <div key={field.fieldId} className="grid gap-2">
              {labelNode}
              <select
                id={`signup-${field.fieldId}`}
                value={value}
                onChange={(e) => onChange(field.fieldId, e.target.value)}
                className={SELECT_CLASS}
                disabled={periodNames.length === 0}
              >
                <option value="">
                  {periodNames.length === 0 ? 'No periods available' : 'Select a period…'}
                </option>
                {periodNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        // 'select'
        return (
          <div key={field.fieldId} className="grid gap-2">
            {labelNode}
            <select
              id={`signup-${field.fieldId}`}
              value={value}
              onChange={(e) => onChange(field.fieldId, e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Select…</option>
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
