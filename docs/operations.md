# Operations & Disaster Recovery

This document covers backups, restores, and disaster-recovery procedures for the Orono Peer Observations system.

## Firestore Backup & PITR

The Firestore database stores multi-year, HR-adjacent staff evaluation records. **All destructive operations (imports, bulk edits, deletions) must be preceded by a backup.**

### Enable Point-in-Time Recovery (PITR)

PITR allows recovery to any point in time within a retention window. Enable it once per project (not per deployment):

```bash
gcloud firestore databases update --database=default \
  --enable-pitr \
  --project=peer-evaluator-rubric
```

This is a one-time setup. After enabling, Firestore retains transaction logs for 7 days by default (can be adjusted up to 35 days if needed).

### Enable Automated Daily Backups

Create a daily automated backup schedule with 7-week retention:

```bash
gcloud firestore backups schedules create \
  --recurrence='DAILY' \
  --retention-duration='7w' \
  --project=peer-evaluator-rubric
```

List existing schedules:

```bash
gcloud firestore backups schedules list --project=peer-evaluator-rubric
```

### Manual Backup (Before Destructive Operations)

Before running `pnpm import:prod` or any bulk admin operation, create a manual backup:

```bash
gcloud firestore backups create \
  --database=default \
  --project=peer-evaluator-rubric
```

Name will be auto-generated; check status:

```bash
gcloud firestore backups list --project=peer-evaluator-rubric
```

Backups are stored in a Cloud Storage bucket managed by Firestore (format: `gs://goog-cm-backup-default-{project-id}/...`).

## Restore from Backup

### Restore from an Automated Backup

List available backups:

```bash
gcloud firestore backups list --project=peer-evaluator-rubric
```

Restore a specific backup by its ID (this overwrites the current database):

```bash
gcloud firestore databases restore \
  --database=default \
  --backup=<BACKUP_ID> \
  --project=peer-evaluator-rubric
```

The restore operation is long-running; check status:

```bash
gcloud firestore operations list --project=peer-evaluator-rubric
```

### Restore Using PITR

To restore to a specific timestamp (within the PITR retention window):

```bash
gcloud firestore databases restore \
  --database=default \
  --backup-time=<RFC3339_TIMESTAMP> \
  --project=peer-evaluator-rubric
```

Example (restore to 2 hours ago):

```bash
gcloud firestore databases restore \
  --database=default \
  --backup-time=$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --project=peer-evaluator-rubric
```

## Cloud Storage Export (Alternative)

Firestore backups are the primary recovery method. For additional long-term archival or to export readable JSON, use gcloud to export to Cloud Storage:

```bash
gcloud firestore export gs://my-backup-bucket/export-$(date +%s) \
  --async \
  --project=peer-evaluator-rubric
```

This creates a versioned export in the bucket (readable, but restore must still go via backup mechanism).

## Pre-Import Checklist

**Before running `pnpm import:prod`:**

1. Ensure PITR is enabled (see above).
2. Create a manual backup (see above).
3. Verify the backup completed successfully (`gcloud firestore backups list`).
4. Run the import with `--confirm` flag:

```bash
GAS_SOURCE_SHEET_ID=<sheet-id> pnpm import:prod --confirm
```

## Year-Over-Year Rollover

At the end of each school year (before rolling over to a new academic year):

1. Create a manual backup (see "Manual Backup" above).
2. Verify the backup completed.
3. Run any bulk data transformations (e.g., archiving completed observations, resetting evaluation windows).
4. Post-rollover, verify data integrity via admin dashboard before communicating cutover to users.

## Cutover Procedure

Before the August 2026 production cutover:

1. Enable PITR on the production project (one-time, must be done before import).
2. Create an automated backup schedule (daily, 7-week retention).
3. Create a manual backup immediately before import.
4. Run the import with `--confirm` and monitor the operation.
5. Post-import, verify all staff, rubrics, and historical observations are present.
6. Go live.

## Monitoring & Alerts

**To monitor backup job completion**, set a Cloud Scheduler job to notify admins if a backup misses its daily window (not yet implemented; can be added as a Cloud Function trigger on backup completion events).

**To audit destructive operations**, check the Cloud Functions logs:

```bash
gcloud functions log read onObservationWritten \
  --project=peer-evaluator-rubric \
  --limit=50
```

Or view the audit log in Firestore (`/auditLog` collection).

## See Also

- [Firestore Backup & Restore docs](https://cloud.google.com/firestore/docs/backups)
- [Scripts/Import README](../scripts/import/README.md) — import prerequisites
- [README.md](../README.md) — system overview
