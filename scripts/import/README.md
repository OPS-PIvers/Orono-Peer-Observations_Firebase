# GAS Sheet → Firestore Import

One-shot import script that reads the legacy Apps Script app's source
spreadsheet and seeds a Firestore database (emulator for dev, live prod
at cutover).

## Usage

```bash
# Dev (emulator)
GAS_SOURCE_SHEET_ID=<sheet-id> pnpm import:emulator

# Production cutover (destructive — will refuse without --confirm)
GAS_SOURCE_SHEET_ID=<sheet-id> pnpm import:prod --confirm
```

If you re-run prod and Firestore already has data, the script aborts
unless you also pass `--force-overwrite` (intentionally awkward).

Pass `--skip-observations` to run faster while iterating on staff/rubric
imports. Drafts are never imported regardless of flags — only Finalized
observations come across as historical archive.

## Required env vars

| Variable                         | What it is                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GAS_SOURCE_SHEET_ID`            | Spreadsheet ID of the legacy GAS app's source sheet                                                           |
| `IMPORT_SECURITY_ADMIN_EMAIL`    | (optional) defaults to `paul.ivers@orono.k12.mn.us`                                                           |
| `GOOGLE_APPLICATION_CREDENTIALS` | (prod only) path to service-account JSON. Skip if you've already run `gcloud auth application-default login`. |

A `.env` file at the repo root (gitignored) is the easiest way to set these.

## Import safety — invite email suppression

The `onStaffWritten` Cloud Function sends a `staff.created` invite email every
time a new `/staff/{email}` document is created. Without protection, a production
cutover import would blast an invite to every staff member the moment the trigger
fires.

**This is handled automatically.** The importer stamps every staff doc with an
`importedAt` server timestamp. The `onStaffWritten` trigger detects this field
and skips the invite email for docs that carry it. No manual template-deactivation
step is required.

Staff members imported this way will **not** receive an invite automatically; an
admin can send one explicitly using the "Resend invite email" row action on the
Staff admin page when the system is ready to go live.

## What gets imported

| Sheet tab              | Firestore destination                      |
| ---------------------- | ------------------------------------------ |
| `Staff`                | `/staff/{email}`                           |
| `Settings`             | `/settings/roleYearMappings/{role}_{year}` |
| Per-role rubric tabs   | `/roles/{slug}` + `/rubrics/{slug}`        |
| `WorkProductQuestions` | `/workProductQuestions/{id}`               |
| `Observation_Data`     | `/observations/{id}` — **Finalized only**  |

Plus **seeds** that don't exist in the source sheet:

- `/emailTemplates/finalizedObservation` — default notification email
- `/appSettings/global` — sensible defaults; admin can edit post-cutover

## Auth setup

For **emulator**: nothing required — admin SDK auto-routes via
`FIRESTORE_EMULATOR_HOST`.

For **prod**: simplest is

```bash
gcloud auth application-default login
```

which writes credentials to `~/.config/gcloud/application_default_credentials.json`.
The Sheets API call uses the same credentials.

If running headless / from CI, set `GOOGLE_APPLICATION_CREDENTIALS` to a
service-account JSON path. The service account needs:

- `roles/datastore.user` (Firestore writes)
- Read access to the source spreadsheet (share the sheet with the SA's
  email, or grant the SA Drive read scope via DWD)

## Producing an emulator seed snapshot

After a successful emulator import, capture a snapshot for fast
re-bootstrapping in future dev sessions:

```bash
firebase emulators:export ./fixtures/seed
```

Then `pnpm dev:emulators` will auto-import from `fixtures/seed/` on
startup, so contributors get a populated DB without re-running the import.
