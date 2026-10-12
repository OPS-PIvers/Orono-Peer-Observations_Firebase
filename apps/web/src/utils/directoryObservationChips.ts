import { OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation } from '@ops/shared';
import { schoolYearOf, toJsDate } from './staffFormatting';

export type DirectoryChipKind = 'OBS' | 'WP' | 'IR';
export type DirectoryChipState = 'inProgress' | 'finalized';

export interface DirectoryChip {
  kind: DirectoryChipKind;
  state: DirectoryChipState;
}

const KIND_BY_TYPE: Record<Observation['type'], DirectoryChipKind> = {
  [OBSERVATION_TYPES.standard]: 'OBS',
  [OBSERVATION_TYPES.workProduct]: 'WP',
  [OBSERVATION_TYPES.instructionalRound]: 'IR',
};

const KIND_ORDER: DirectoryChipKind[] = ['OBS', 'WP', 'IR'];

export const DIRECTORY_CHIP_KIND_LABEL: Record<DirectoryChipKind, string> = {
  OBS: 'Observation',
  WP: 'Work Product',
  IR: 'Instructional Round',
};

/**
 * Staff Directory chips for the observations the viewer created, keyed on
 * lowercased observed email. One chip per type: "in progress" when any of
 * that type is still a Draft (whatever its date), otherwise "finalized" when
 * one was finalized this school year. Older finalized observations show
 * nothing, so last year's work doesn't read as done for this year.
 */
export function directoryObservationChips(
  observations: readonly Pick<
    Observation,
    'observedEmail' | 'type' | 'status' | 'observationDate'
  >[],
  now: Date = new Date(),
): Map<string, DirectoryChip[]> {
  const thisYear = schoolYearOf(now);
  const states = new Map<string, Map<DirectoryChipKind, DirectoryChipState>>();

  for (const o of observations) {
    const kind = KIND_BY_TYPE[o.type] as DirectoryChipKind | undefined;
    if (!kind || !o.observedEmail) continue;
    let state: DirectoryChipState | null = null;
    if (o.status === OBSERVATION_STATUS.draft) {
      state = 'inProgress';
    } else {
      const date = toJsDate(o.observationDate);
      if (date && schoolYearOf(date) === thisYear) state = 'finalized';
    }
    if (!state) continue;
    const email = o.observedEmail.toLowerCase();
    let byKind = states.get(email);
    if (!byKind) {
      byKind = new Map();
      states.set(email, byKind);
    }
    // In progress wins over finalized for the same type.
    if (byKind.get(kind) !== 'inProgress') byKind.set(kind, state);
  }

  const chips = new Map<string, DirectoryChip[]>();
  for (const [email, byKind] of states) {
    chips.set(
      email,
      KIND_ORDER.flatMap((kind) => {
        const state = byKind.get(kind);
        return state ? [{ kind, state }] : [];
      }),
    );
  }
  return chips;
}
