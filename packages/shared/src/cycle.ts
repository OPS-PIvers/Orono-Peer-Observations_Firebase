/**
 * Cycle state — pure domain logic shared by the web client, schemas, and
 * (mirrored, by hand) the Firestore security rules.
 *
 * Year encoding (mirrors GAS Constants.js): 1-3 = continuing-contract years;
 * 4-6 = probationary P1-P3, which display as 1-3.
 */

export const CYCLE_STATUSES = ['low', 'high', 'probationary'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** Stored years 1-3 are continuing; 4-6 are probationary P1-P3. Both display as 1-3. */
export function displayYear(year: number): 1 | 2 | 3 {
  const d = year >= 4 ? year - 3 : year;
  return (d < 1 ? 1 : d > 3 ? 3 : d) as 1 | 2 | 3;
}

export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  return summativeYear ? 'high' : 'low';
}

/**
 * Inclusive start of the school year containing `now` — Aug 1, local time.
 * July and earlier belong to the prior year's cycle; August begins the new
 * one. Mirrors the dashboard's "2025 — 2026" school-year label, so queries
 * scoped with this boundary agree with what the hero eyebrow claims.
 */
export function schoolYearStart(now: Date = new Date()): Date {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(startYear, 7, 1);
}

/** Stored `year`/`summativeYear` pair — the two fields the rollover advances. */
export interface CycleState {
  /** 1-3 = continuing-contract years; 4-6 = probationary P1-P3. */
  year: number;
  /** High-cycle (summative) flag for continuing years; always true while probationary. */
  summativeYear: boolean;
}

/**
 * Advance a staff member's cycle state by one school year — the pure core of
 * the "Advance school year" rollover tool. Mirrors the district progression
 * rules; every consumer (the preview table, the batch write) reads from here so
 * the displayed old→new mapping and the persisted value can never drift.
 *
 * Continuing-contract teachers (stored years 1-3) walk a fixed three-year
 * evaluation cycle:
 *
 *   Y1 (low) → Y2 (low) → Y3 (high/summative) → Y1 (low) → …
 *
 * The cycle culminates in the Year-3 summative ("high cycle") year, then resets
 * to a fresh low-cycle Year 1 — this is the "Y1→Y2→Y3→Y1 with high-cycle
 * placement" rule. `summativeYear` is therefore derived purely from the *new*
 * year (`true` iff the new year is 3), so a hand-edited cohort self-corrects on
 * the next rollover rather than carrying a stale flag forward.
 *
 * Probationary teachers (stored years 4-6 = P1-P3) advance P1→P2→P3, then on
 * completing P3 roll over to a continuing-contract Year 1 (Minnesota's
 * three-year probationary period). Probationary records canonically carry
 * `summativeYear: true` (matching `encodeYearStatus`), and that is preserved
 * while still probationary; the graduating P3→Y1 transition resets it to the
 * low-cycle start (`false`).
 *
 * Years outside 1-6 are clamped into range before advancing, so a corrupt
 * stored value never produces an out-of-range result.
 */
export function advanceCycle(state: CycleState): CycleState {
  const { year } = state;
  if (year >= 4) {
    // Probationary P1-P3 (stored 4-6).
    const p = Math.min(year, 6);
    if (p < 6) {
      // P1→P2 or P2→P3 — stay probationary (summative by convention).
      return { year: p + 1, summativeYear: true };
    }
    // P3 graduates to a continuing-contract Year 1, low cycle.
    return { year: 1, summativeYear: false };
  }

  // Continuing Y1-Y3 (stored 1-3): wrap 1→2→3→1, summative only in Year 3.
  // The new summative flag is re-derived from the new year, deliberately
  // discarding any stale hand-edited flag so the cohort self-corrects.
  const y = Math.max(year, 1);
  const nextYear = y >= 3 ? 1 : y + 1;
  return { year: nextYear, summativeYear: nextYear === 3 };
}
