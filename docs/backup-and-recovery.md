# TaskFlow Production Backup & Recovery Runbook — PR #50

## Scope and evidence

The automated PostgreSQL recovery rehearsal runs **only** against the disposable
GitHub Actions PostgreSQL 18 service database `taskflow_integration`. It uses
PostgreSQL 18 client tools to create a custom-format database dump, restores that
dump into the *new* temporary database `taskflow_restore_verify`, compares
sorted content fingerprints and counts for accounts, tasks, activity,
snapshots, notification state/preferences, and EF migration history, and
verifies account integrity and the task-history index. The temporary database
and dump are deleted at the end. This verifies the app's logical
dump/restore mechanics for representative integration-test data.

**A successful CI rehearsal does NOT mean a production backup exists, is
current, is encrypted, or can be recovered within a particular RPO/RTO.**
No production dump is generated, transmitted, or saved by this change.
No production task, user, or history data is written by the rehearsal.

## Existing provider configuration and risks

The Render database settings accessible during the audit (Nov 22, 2026)
reported: PostgreSQL 18, Ohio region, primary, 1-GB disk, no high
availability, no read replica, autoscaling disabled, and an IP allowlist
entry `0.0.0.0/0`. Those settings **do not establish a verified automated
backup or point-in-time restore capability**. Confirm the provider's
current plan-specific backup retention and recovery eligibility directly
in the Render database dashboard, rather than assuming they exist.

Publicly reachable connection ingress is a separate security concern.
Restrict network access to only required sources after reviewing the
production API's database connectivity. Never paste connection strings,
database passwords, or backups into pull requests, issues, CI logs, or chat.

## Recovery readiness checklist (operator-owned)

1. In the Render database dashboard, confirm **whether** backups are enabled,
   their retention window, most recent successful backup, restore target
   options, and any billing/plan restrictions. Save only non-secret backup
   metadata and a timestamp in the incident record.
2. Define business requirements: acceptable data loss (**RPO**) and
   service recovery time (**RTO**). They have not yet been agreed.
3. Arrange a supported, encrypted, access-restricted production backup
   process if automated backups are not confirmed. Use least-privilege
   credentials, encrypted offsite retention, and scheduled alerts for missed
   backups. The CI rehearsal is not a substitute for this.
4. For a real recovery drill, restore a provider-created backup to a **new,
   isolated, non-production database** using the provider's documented flow.
   Limit access, never point the live API at the drill target, and protect
   personal task content. Obtain permission for data handling before any drill.
5. Verify schema and applied migration IDs, account-to-task ownership,
   version-history access isolation, consistency of counts, and selective
   sign-in/task read against the isolated target. **Do not issue mutation
   requests to the live service.** Record restore timestamps, drill outcome,
   actual RPO/RTO observed, and who authorized the test.
6. Revoke temporary credentials, securely dispose of drill data and artifacts,
   and revisit the recovery procedure after schema changes.

## Incident procedure

If the live database is unavailable or data corruption is suspected: stop
write-producing traffic first through the approved operations process, gather
logs without PII, and establish the incident's timeline and affected
migrations. Confirm the latest known-good *production* backup **before**
considering replacement. Avoid `DROP DATABASE`, `pg_restore --clean`, or
manual edits to production task tables. A production failover or data restore
is a separate human-approved operation with a documented rollback plan.

## Rehearsal safety boundary

`scripts/verify-postgres-recovery.sh` refuses execution unless
`TASKFLOW_RECOVERY_TEST=1` and the connection string matches the exact
disposable localhost CI database credentials. The source and target names,
host, database user, and PostgreSQL image are fixed in the script. It fails
if the disposable target already exists; it never drops an existing database
before claiming ownership. It does not write artifacts to GitHub.
