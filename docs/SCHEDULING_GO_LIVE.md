# Scheduling go-live checklist — 2026-08-26

The self-scheduling path (observation windows → invites → slots → booking → observation) is **fully
built and fully deployed, and has never once run in production.** As of this audit
`/observationWindows` holds **zero documents**.

This is not neglect. Window creation has been failing for everyone, every time, on a missing
precondition (item 1 below). Everything downstream of that has therefore never been exercised
against real data.

**Method.** Code trace of the whole path plus read-only queries against production Firestore
(`peer-evaluator-rubric`) via Application Default Credentials, plus a local dry-run of the real slot
engine. Nothing in prod was written during the audit. The one production write made in this session
was unrelated (`appSettings/dashboard` → `steps[0].doneWhen`).

**Scope limit.** No window was created, so nothing past `createObservationWindow` has been executed —
only read. Items marked _verified_ were actually run; items marked _untested_ are code-reading only.

---

## 1. BLOCKER — no building has a bell schedule

`/buildingSchedules` is **empty**. `createObservationWindow` resolves a schedule doc per invitee
building and throws before writing anything:

```
failed-precondition: Missing building schedule(s): ohs
```

See `apps/functions/src/scheduling/createObservationWindow.ts` (the `missingSchedules` check).
Slots are generated _from_ the bell schedule, so with no schedule there is nothing to book.

**Fix:** Admin → **Buildings** → row menu → **Edit schedule**, for every building you intend to
invite from. The editor (`apps/web/src/admin/buildings/BuildingSchedulePage.tsx`) is complete: day
types, periods, weekly pattern, date overrides, effective-date bounds, and draft/archive versioning.

It needs real Orono bell times. Do not guess them — wrong period times generate wrong slots, and
staff book against them.

The seven active buildings and their slug ids (this is what `buildingId` must be):

| slug    | displayName      |
| ------- | ---------------- |
| `dc`    | DC               |
| `do`    | DO               |
| `is`    | Intermediate     |
| `ohs`   | High School      |
| `oms`   | Middle School    |
| `se`    | Schumann         |
| `sp-ed` | Special Services |

Staff docs store building **display names** (`["High School","DO"]`), not slugs. The create-window
dialog maps name → slug and refuses to submit unresolved invitees, so this is handled — but keep it
in mind when writing any schedule doc by hand, since the doc id must be the **slug**.

---

## 2. Your 3:00 PM cutoff silently deletes the last period

`appSettings/global.scheduling` in production:

```
defaultEarliestMinute: 480   (8:00 AM)
defaultLatestMinute:   900   (3:00 PM)
```

Slot generation drops any period that starts before `earliestMinute` or ends after `latestMinute`,
with **no warning anywhere in the UI** — the slots simply are not there.

_Verified_ by dry-run: against an 8-period High School day, Period 7 (2:23–3:16 PM) vanished
entirely. The PE creating the window has no way to notice.

**Fix:** raise `latestMinute` when creating a window (or change the default on
Admin → Scheduling) so it spans the full school day. Check both ends against each building's real
first and last period.

---

## 3. `requireCalendarConnect` is inert as configured

Production has `requireCalendarConnect: true`, but it is enforced in exactly one place —
`apps/functions/src/scheduling/bookObservationSlot.ts` (~line 225), the **direct-booking** path.

Production also restricts `allowedBookingModes` to **`['day-preference']`** only — direct booking
is switched off.
Day-preference routes through `submitDayPreference` → `assignObservationFromPreference`, and
**neither checks the flag.**

So the toggle is on and does nothing. Decide which you actually want:

- enforce it in the day-preference path too, or
- turn it off so the admin UI stops implying a guarantee it isn't making.

---

## 4. `gcalConflictPolicy: 'block'` with one connected calendar

Production is set to `'block'` (hard-reject slots that collide with the observer's real Google
Calendar). `/userCalendarTokens` contains **exactly one document** — `paul.ivers@orono.k12.mn.us`.

There are 5 PEs/admins on the active roster:

- `bailey.nett@orono.k12.mn.us` (instructional-specialist, admin)
- `jessica.hovland@orono.k12.mn.us` (peer-evaluator)
- `kelly.leibfried@orono.k12.mn.us` (peer-evaluator)
- `paul.ivers@orono.k12.mn.us` (instructional-specialist, admin) — connected
- `ryan.fiskey@orono.k12.mn.us` (peer-evaluator)

**Untested:** what `'block'` does when the observer has no calendar connected. Confirm before
go-live — if it blocks everything, four of five PEs cannot take bookings.

---

## 5. Creating a window emails every invitee immediately

`inviteEmailEnabled: true` in production. `createObservationWindow` sends invite emails at the end of
the call, best-effort.

⚠️ The function's own doc comment claims _"No email is sent (that's a later phase)."_ **That comment
is stale and wrong.** It sends. Do not trust it, and do not rehearse against real staff.

**Rehearse with a window that invites only yourself.** One email, to you.

---

## Verified working — do not re-audit these

- **All 11 scheduling functions are deployed** to prod (us-central1, nodejs22):
  `createObservationWindow`, `cancelObservationWindow`, `updateObservationWindow`,
  `expireObservationWindows`, `onBuildingScheduleWritten`, `bookObservationSlot`,
  `submitDayPreference`, `assignObservationFromPreference`, `cancelBooking`, `rescheduleBooking`,
  `resendWindowInvite`, `checkSlotConflicts`.
- **Slot engine is correct.** _Verified_ by local dry-run of the real
  `generateSlotsForWindow`: 56 slots across 8 school days; weekends excluded; a Labor Day
  `dayTypeId: null` override honored; DST-correct UTC composition (8:05 AM CDT → `13:05Z`);
  slot ids (`${buildingId}-${dateYMD}-${periodId}`) stable so regeneration is idempotent.
- **Building name → slug mapping** is correct in `CreateObservationWindowDialog`, and unresolved
  invitees block submission.
- **Day-preference UI is complete on both sides** — staff day picker in `BookingPage`, PE assignment
  via `AssignPreferencesPage` and `AutoAssignDialog`.
- **Email templates present and active**: the full `scheduling-*` set (invite, booking confirmation,
  assignment notice, cancellation).
- **Signup fields** exist (2, both active) and gate submission via `signupFieldsComplete`.

---

## Order of work

1. Author a bell schedule for **one** building (start with `ohs`). Item 1.
2. Raise the window's `latestMinute` past the real last-period end. Item 2.
3. Create a window inviting **only yourself**, day-preference mode. Item 5.
4. Walk it: invite email → `/book/{windowId}?token=…` → submit a day preference →
   assign it as the PE → confirm the observation is created → confirm the staff dashboard's
   "Sign up for an observation window" card now appears and completes correctly.
   (That card's completion rule was fixed in `5e2d638`; it now completes on `signupSlotBooked`,
   not on the mere existence of an observation.)
5. Resolve items 3 and 4 before inviting anyone else.
6. Then author the remaining six building schedules.

---

## Reproducing the audit

Read-only prod queries used ADC (`gcloud auth application-default login`) with
`scripts/import/firebase.ts`'s `initFirestore('prod')`. The slot dry-run imports
`apps/functions/src/scheduling/engine/slotGeneration.ts` directly and touches nothing — it is a pure
function. Both were throwaway `.mts` scripts run under `pnpm exec tsx`; neither is committed.

## Loose end unrelated to scheduling

3 of 236 observation docs lack the `observationId` field the schema marks required —
`65VSbNZRwzcmsfrx85yT`, `a6wfKUFXx17ZGz048WjZ`, `8BYaQNmzxly9OebkzOEe` (all Drafts). Commit
`5e2d638` made the dashboard fall back to the Firestore doc id so the broken
`/observations/undefined` links resolve, but the documents themselves are still malformed. A
`backfillObservationIds` callable already exists (`apps/functions/src/scripts/`) if you want them
repaired at the source.
