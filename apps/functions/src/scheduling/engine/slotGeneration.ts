import {
  OBSERVATION_SLOT_STATUS,
  type BuildingSchedule,
  type ObservationSlot,
  type ObservationWindow,
  type ScheduleDayType,
} from '@ops/shared';

/**
 * Pure, deterministic slot generation for an observation window.
 *
 * Slot ids are `${buildingId}-${dateYMD}-${periodId}` so regeneration is
 * idempotent. Absolute instants (`startUTC`/`endUTC`) are composed from a
 * building-local (date + minute-of-day) using the DST-safe Intl-offset
 * technique (mirrors `email/scheduledEmailReminders.ts#chicagoMidnight`),
 * so a 9:00 AM period maps to the correct UTC instant whether the date is
 * in CST or CDT.
 */

/** A slot doc's fields minus `generatedAt` — the caller stamps that with a
 *  Firestore serverTimestamp. */
export type SlotInput = Omit<ObservationSlot, 'generatedAt'>;

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Compose a building-local (`dateYMD`, `minuteOfDay`) into the absolute UTC
 * instant for that wall-clock time in `timeZone`. DST-safe: the UTC offset is
 * derived from the target zone via Intl rather than assuming a fixed offset.
 */
export function localMinuteToUTC(dateYMD: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = dateYMD.split('-').map(Number) as [number, number, number];
  const localHour = Math.floor(minuteOfDay / 60);
  const localMin = minuteOfDay % 60;

  // Anchor: pretend the wall-clock is UTC, then measure how far the zone is
  // from UTC at that instant and correct. Using the target wall-clock as the
  // probe instant keeps us on the correct side of any DST transition for
  // ordinary school-day periods.
  const naiveUTC = Date.UTC(y, m - 1, d, localHour, localMin, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(new Date(naiveUTC));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  let zHour = get('hour');
  // Intl renders midnight as 24 in some engines; normalize to 0.
  if (zHour === 24) zHour = 0;
  const asUTCofZoned = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    zHour,
    get('minute'),
    get('second'),
  );
  // offset = (what the zone reads) - (the instant we probed). The zone time
  // for `naiveUTC` differs from the wall-clock we want by exactly the offset.
  const offsetMs = asUTCofZoned - naiveUTC;
  return new Date(naiveUTC - offsetMs);
}

/** Iterate inclusive YYYY-MM-DD dates from `startYMD` to `endYMD`. */
function* eachDate(startYMD: string, endYMD: string): Generator<string> {
  const [sy, sm, sd] = startYMD.split('-').map(Number) as [number, number, number];
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const endParts = endYMD.split('-').map(Number) as [number, number, number];
  const end = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
  while (cursor.getTime() <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

/** Weekday index 0=Sun..6=Sat for a YYYY-MM-DD date (timezone-independent —
 *  computed at UTC noon to avoid edge ambiguity). */
function weekdayOf(dateYMD: string): number {
  const [y, m, d] = dateYMD.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * Resolve the day-type id that applies on `dateYMD`:
 *   - a matching `overrides` entry wins (its `dayTypeId === null` ⇒ no school)
 *   - otherwise the `weeklyPattern` slot for that weekday (null ⇒ no school)
 * Returns `null` when no school / no pattern applies.
 */
function resolveDayTypeId(
  schedule: BuildingSchedule,
  dateYMD: string,
  weekday: number,
): string | null {
  const override = schedule.overrides.find((o) => o.date === dateYMD);
  if (override) return override.dayTypeId; // may be null = explicit no-school
  const key = WEEKDAY_KEYS[weekday];
  if (key === undefined || key === 'sun' || key === 'sat') return null;
  return schedule.weeklyPattern[key];
}

/**
 * Generate all candidate slots for every distinct building among the window's
 * invitees. Buildings without a schedule in `schedulesByBuilding` are skipped.
 */
export function generateSlotsForWindow(
  window: ObservationWindow,
  schedulesByBuilding: Map<string, BuildingSchedule>,
): SlotInput[] {
  const buildingIds = [...new Set(window.invitees.map((inv) => inv.buildingId))].sort();
  const weekdaysIncluded = new Set(window.weekdaysIncluded);
  const slots: SlotInput[] = [];

  for (const buildingId of buildingIds) {
    const schedule = schedulesByBuilding.get(buildingId);
    if (!schedule) continue;

    const dayTypeById = new Map<string, ScheduleDayType>();
    for (const dt of schedule.dayTypes) dayTypeById.set(dt.dayTypeId, dt);

    for (const dateYMD of eachDate(window.startDate, window.endDate)) {
      if (schedule.effectiveFrom && dateYMD < schedule.effectiveFrom) continue;
      if (schedule.effectiveTo && dateYMD > schedule.effectiveTo) continue;

      const weekday = weekdayOf(dateYMD);
      if (!weekdaysIncluded.has(weekday)) continue;

      const dayTypeId = resolveDayTypeId(schedule, dateYMD, weekday);
      if (dayTypeId === null) continue;

      const dayType = dayTypeById.get(dayTypeId);
      if (!dayType || dayType.isNoSchool) continue;

      // Stable intra-day ordering by start minute then periodId.
      const periods = [...dayType.periods].sort(
        (a, b) => a.startMinute - b.startMinute || a.periodId.localeCompare(b.periodId),
      );

      for (const period of periods) {
        if (period.startMinute < window.earliestMinute) continue;
        if (period.endMinute > window.latestMinute) continue;

        slots.push({
          slotId: `${buildingId}-${dateYMD}-${period.periodId}`,
          windowId: window.windowId,
          buildingId,
          dateYMD,
          dayTypeId: dayType.dayTypeId,
          periodId: period.periodId,
          periodName: period.name,
          startUTC: localMinuteToUTC(dateYMD, period.startMinute, schedule.timeZone),
          endUTC: localMinuteToUTC(dateYMD, period.endMinute, schedule.timeZone),
          startMinute: period.startMinute,
          status: OBSERVATION_SLOT_STATUS.available,
          blockedReason: null,
          bookedBy: null,
          bookedAt: null,
          observationId: null,
        });
      }
    }
  }

  return slots;
}
