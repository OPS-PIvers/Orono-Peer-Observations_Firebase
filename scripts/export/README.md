# Firestore → JSON/CSV Export

Read-only backup / district-reporting / year-end archival tooling. Exports
current Firestore data to a local output directory — one JSON file per
collection, plus a CSV for the staff roster (same shape as StaffPage's
"Export CSV" button, so the two are directly comparable).

This script never writes to Firestore.

## Usage

```bash
# Dev (emulator)
pnpm export:emulator

# Production
pnpm export:prod

# Only some collections
tsx scripts/export/export.ts --target=prod --collections=staff,rubrics

# Custom output directory (default: exports/<target>-<timestamp>/)
tsx scripts/export/export.ts --target=prod --out=./exports/2026-06-30
```

## What gets exported

| Collection     | Output file(s)            |
| -------------- | ------------------------- |
| `staff`        | `staff.json`, `staff.csv` |
| `observations` | `observations.json`       |
| `rubrics`      | `rubrics.json`            |
| `auditLog`     | `auditLog.json`           |

Every export also writes `manifest.json` with the target, timestamp, and
per-collection row counts.

Firestore `Timestamp` fields are converted to ISO 8601 strings in the JSON
output. `staff.csv` resolves `role`/`modules` ids to their current display
names (reading `/roles` and `/modules`), matching the admin UI's roster
export — role/module renames after the fact will not retroactively change a
previously exported file, same as the admin UI export.

Use `--collections=` to limit the export to a subset (comma-separated,
values: `staff`, `observations`, `rubrics`, `auditLog`). Omit it to export
all four.

## Auth setup

Same as `scripts/import` — see [`scripts/import/README.md`](../import/README.md#auth-setup).

For **emulator**: nothing required — admin SDK auto-routes via
`FIRESTORE_EMULATOR_HOST`.

For **prod**: simplest is

```bash
gcloud auth application-default login
```

or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON path with
`roles/datastore.viewer` (or broader) Firestore read access.

## Notes

- This is intentionally read-only and has no `--confirm`/`--force-overwrite`
  guard rails like `scripts/import` — exporting cannot corrupt Firestore
  data. It writes to the local filesystem only.
- `auditLog.json` and `observations.json` can be large in a long-lived
  district deployment; there's no `--limit` flag today — the script always
  reads the full collection. Filter with `--collections=` to skip
  collections you don't need for a given export.
- Exported files contain PII (staff emails/names, observation content) and
  are written to the local filesystem — handle the output directory
  according to district data-retention policy; it is not automatically
  gitignored beyond the repo's existing `exports/` in `.gitignore` (added
  alongside this script).
