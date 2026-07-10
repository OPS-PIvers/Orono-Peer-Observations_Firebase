import type { ObservationPreference, ObservationSlot, ObservationWindow } from '@ops/shared';
import { toDate } from './slotTime';

/**
 * Client-side greedy matcher backing AssignPreferencesPage's "Auto-assign
 * all" action. It proposes a conflict-free assignment across every pending
 * (unassigned) day preference in one pass, considering all preferences
 * together instead of one dropdown at a time.
 *
 * This is a *proposal* only — nothing is written here. The caller confirms
 * the plan and then executes it by calling the existing
 * `assignObservationFromPreference` callable once per proposed row, which
 * re-validates everything (slot still available, no PE conflict, etc.)
 * inside its own transaction. So a stale/racy proposal fails safely at
 * execution time rather than corrupting data.
 *
 * The conflict check below mirrors `peConflicts`/`intervalsOverlap` in
 * apps/functions/src/scheduling/engine/timeWindows.ts (the server-side
 * source of truth enforced at commit time). It's duplicated here — rather
 * than imported — because that module lives in the functions package and
 * pulls in Admin SDK-adjacent code not meant for the browser bundle.
 */

export type PreferenceDoc = ObservationPreference & { id: string };
export type SlotDoc = ObservationSlot & { id: string };

export interface AutoAssignProposal {
  prefId: string;
  email: string;
  name: string;
  buildingId: string;
  preferredDateYMD: string;
  slotId: string;
  slotStartUTC: unknown;
  slotEndUTC: unknown;
  periodName: string;
}

export interface AutoAssignSkip {
  prefId: string;
  email: string;
  name: string;
  preferredDateYMD: string;
  reason: string;
}

export interface AutoAssignPlan {
  proposals: AutoAssignProposal[];
  skipped: AutoAssignSkip[];
}

/** True when `[aStart, aEnd)` overlaps `[bStart, bEnd)` after padding the B
 *  interval by `bufferMs` on both ends. Mirrors the server's `intervalsOverlap`. */
function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
  bufferMs: number,
): boolean {
  return aStartMs < bEndMs + bufferMs && bStartMs < aEndMs + bufferMs;
}

type WindowForMatch = Pick<ObservationWindow, 'peBusyIntervals' | 'travelBufferMinutes'>;

/**
 * Build a conflict-free auto-assign plan across every unassigned preference.
 *
 * Preferences are considered in order of preferred day, then submission
 * time (first-come-first-served) — the same tiebreak the day-preference cap
 * itself is meant to imply. For each preference, the earliest available slot
 * in its building on its preferred day that doesn't collide (± travel
 * buffer) with an already-proposed or already-booked PE interval is
 * proposed; a preference with no such slot is reported as skipped with a
 * reason instead of silently dropped.
 */
export function buildAutoAssignPlan(
  preferences: readonly PreferenceDoc[],
  slots: readonly SlotDoc[],
  window: WindowForMatch,
): AutoAssignPlan {
  const pending = preferences
    .filter((p) => p.assignedSlotId == null)
    .slice()
    .sort((a, b) => {
      if (a.preferredDateYMD !== b.preferredDateYMD) {
        return a.preferredDateYMD.localeCompare(b.preferredDateYMD);
      }
      const aTime = toDate(a.submittedAt)?.getTime() ?? 0;
      const bTime = toDate(b.submittedAt)?.getTime() ?? 0;
      return aTime - bTime;
    });

  const candidatesByKey = new Map<string, SlotDoc[]>();
  for (const s of slots) {
    if (s.status !== 'available') continue;
    const key = `${s.buildingId}|${s.dateYMD}`;
    const list = candidatesByKey.get(key);
    if (list) list.push(s);
    else candidatesByKey.set(key, [s]);
  }
  for (const list of candidatesByKey.values()) list.sort((a, b) => a.startMinute - b.startMinute);

  const takenSlotIds = new Set<string>();
  const busy: { startMs: number; endMs: number }[] = [];
  for (const interval of window.peBusyIntervals) {
    const start = toDate(interval.startUTC);
    const end = toDate(interval.endUTC);
    if (start && end) busy.push({ startMs: start.getTime(), endMs: end.getTime() });
  }
  const bufferMs = window.travelBufferMinutes * 60_000;

  const proposals: AutoAssignProposal[] = [];
  const skipped: AutoAssignSkip[] = [];

  for (const pref of pending) {
    const key = `${pref.buildingId}|${pref.preferredDateYMD}`;
    const candidates = candidatesByKey.get(key) ?? [];

    let picked: SlotDoc | null = null;
    for (const candidate of candidates) {
      if (takenSlotIds.has(candidate.slotId)) continue;
      const start = toDate(candidate.startUTC);
      const end = toDate(candidate.endUTC);
      if (!start || !end) continue;
      const startMs = start.getTime();
      const endMs = end.getTime();
      const conflicts = busy.some((b) =>
        intervalsOverlap(startMs, endMs, b.startMs, b.endMs, bufferMs),
      );
      if (conflicts) continue;
      picked = candidate;
      break;
    }

    if (!picked) {
      skipped.push({
        prefId: pref.id,
        email: pref.email,
        name: pref.name || pref.email,
        preferredDateYMD: pref.preferredDateYMD,
        reason:
          candidates.length === 0
            ? 'No open slots on the preferred day.'
            : 'Every open slot on the preferred day conflicts with another assignment.',
      });
      continue;
    }

    takenSlotIds.add(picked.slotId);
    const start = toDate(picked.startUTC);
    const end = toDate(picked.endUTC);
    if (start && end) busy.push({ startMs: start.getTime(), endMs: end.getTime() });

    proposals.push({
      prefId: pref.id,
      email: pref.email,
      name: pref.name || pref.email,
      buildingId: pref.buildingId,
      preferredDateYMD: pref.preferredDateYMD,
      slotId: picked.slotId,
      slotStartUTC: picked.startUTC,
      slotEndUTC: picked.endUTC,
      periodName: picked.periodName,
    });
  }

  return { proposals, skipped };
}
