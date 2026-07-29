import { OBSERVATION_STATUS, PROFICIENCY_LEVELS, type Observation } from '@ops/shared';
import { toJsDate } from './staffFormatting';

/**
 * The shape actually delivered by `useFirestoreCollection` — a raw client
 * snapshot read (`snap.docs.map(d => d.data())`) that, unlike a
 * Zod-validated write, never applies the schema's `.default(...)` values.
 * A legacy doc can genuinely lack `observationData` or `rubricSnapshot`
 * even though `Observation`'s inferred type says they're always present.
 * Modeling them as optional here (rather than trusting `Observation`) lets
 * the fallbacks below be real type-checked branches, not suppressions.
 */
type RawGrowthObservation = Pick<Observation, 'status' | 'observationDate' | 'observationName'> & {
  id: string;
  rubricSnapshot?: Observation['rubricSnapshot'];
  observationData?: Observation['observationData'];
};

/** One finalized observation's average proficiency for a single rubric
 *  domain — 0 (developing) to 3 (distinguished). */
export interface GrowthTrendPoint {
  observationId: string;
  observationName: string;
  date: Date;
  /** Average of `PROFICIENCY_LEVELS` indices across the domain's scored
   *  components in this observation (0-3). */
  average: number;
  /** How many of the domain's components had a proficiency recorded. */
  scoredCount: number;
  /** Total components in the domain (per this observation's rubric
   *  snapshot — domains can vary in size across role/rubric changes). */
  totalCount: number;
}

/** A rubric domain's proficiency trend across the signed-in staff member's
 *  own finalized observations, in chronological order.
 *
 *  Keyed by *rubric* + domain, not domain id alone: `rubricId` is
 *  deliberately decoupled from `roleId` (see `packages/shared/src/schema/
 *  role.ts`) so multiple roles can share one rubric, and the framework
 *  convention numbers domains '1'-'4' in *every* rubric. Keying by
 *  `domainId` alone would silently average two incommensurable measures
 *  into one line for a staff member observed under two different rubrics
 *  (e.g. after a role change) — this is a personal evaluation trend, and a
 *  misleading line here is worse than no line. */
export interface GrowthTrendSeries {
  rubricId: string;
  /** Most recent snapshot's display name for this rubric — rubric names
   *  are stable in practice but this avoids trusting the very first
   *  sighting. */
  rubricName: string;
  domainId: string;
  /** Most recent snapshot's name for this domain id — domain names are
   *  stable in practice but this avoids trusting the very first sighting. */
  domainName: string;
  points: GrowthTrendPoint[];
}

/** Series key: rubric identity + domain id, never domain id alone — see
 *  `GrowthTrendSeries` doc comment. */
function seriesKey(rubricId: string, domainId: string): string {
  return `${rubricId} ${domainId}`;
}

/** Type guard rejecting any proficiency value that isn't exactly one of the
 *  four canonical literals. Guards `PROFICIENCY_LEVELS.indexOf(...)`, which
 *  reads a value straight off a raw, Zod-bypassing Firestore snapshot (see
 *  `RawGrowthObservation` above) — an unrecognized string would otherwise
 *  yield `indexOf` === -1 and silently corrupt the average. */
function isKnownProficiency(value: unknown): value is (typeof PROFICIENCY_LEVELS)[number] {
  return typeof value === 'string' && (PROFICIENCY_LEVELS as readonly string[]).includes(value);
}

/**
 * Self-only proficiency trend, broken out by rubric domain.
 *
 * For each finalized observation with a frozen `rubricSnapshot`, averages
 * the `PROFICIENCY_LEVELS` index (developing=0 ... distinguished=3) of the
 * domain's components that have a recognized, non-null proficiency in
 * `observation.observationData`. Domains with nothing scored in a given
 * observation are omitted from that observation's contribution (never
 * plotted as a false 0). A component whose recorded proficiency isn't one
 * of the four canonical levels (e.g. corrupted or pre-migration data) is
 * likewise skipped rather than scored as -1.
 *
 * Reads raw Firestore snapshot data (via `useFirestoreCollection`, which
 * bypasses Zod parsing), so every field is treated as possibly-missing on
 * legacy docs — falls back to the schema's own defaults explicitly rather
 * than trusting the field is present.
 */
export function computeGrowthTrend(
  observations: readonly RawGrowthObservation[],
): GrowthTrendSeries[] {
  const dated: { obs: RawGrowthObservation; date: Date }[] = [];
  for (const obs of observations) {
    if (obs.status !== OBSERVATION_STATUS.finalized) continue;
    if (!obs.rubricSnapshot) continue;
    const date = toJsDate(obs.observationDate);
    if (!date) continue;
    dated.push({ obs, date });
  }
  dated.sort((a, b) => a.date.getTime() - b.date.getTime());

  const seriesByKey = new Map<string, GrowthTrendSeries>();
  for (const { obs, date } of dated) {
    const snapshot = obs.rubricSnapshot;
    if (!snapshot) continue;
    const observationData = obs.observationData ?? {};
    for (const domain of snapshot.domains) {
      let sum = 0;
      let scoredCount = 0;
      for (const component of domain.components) {
        const proficiency = observationData[component.id]?.proficiency;
        if (!isKnownProficiency(proficiency)) continue;
        sum += PROFICIENCY_LEVELS.indexOf(proficiency);
        scoredCount += 1;
      }
      if (scoredCount === 0) continue;

      const key = seriesKey(snapshot.rubricId, domain.id);
      let series = seriesByKey.get(key);
      if (!series) {
        series = {
          rubricId: snapshot.rubricId,
          rubricName: snapshot.displayName,
          domainId: domain.id,
          domainName: domain.name,
          points: [],
        };
        seriesByKey.set(key, series);
      }
      series.rubricName = snapshot.displayName;
      series.domainName = domain.name;
      series.points.push({
        observationId: obs.id,
        observationName: obs.observationName || 'Untitled observation',
        date,
        average: sum / scoredCount,
        scoredCount,
        totalCount: domain.components.length,
      });
    }
  }

  return Array.from(seriesByKey.values());
}
