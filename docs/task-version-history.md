# Task Version History & Restore (PR #49)

TaskFlow stores complete task snapshots in a **new**, account-owned `TaskVersions`
table: title, completion state, priority, due date, category, recurrence,
reminders, notes, and checklist. These snapshots contain personal task content
and must never be logged, exposed across accounts, or included in telemetry.
The user ID comes exclusively from the authenticated identity.

The authenticated `GET /api/tasks/{id}/versions` returns at most 50 newest
snapshots for a task after verifying ownership. Absent and cross-account tasks
both return 404. A full snapshot is saved at task creation, at successful
updates, and after a restore. Tasks predating the feature receive an original
baseline snapshot **only when they are next successfully changed**. No
historical records are manufactured during deployment.

Restoration uses `POST /api/tasks/{id}/restore` with `{versionId}` and a
required quoted current `If-Match` fingerprint. The backend verifies both
task and version ownership, validates restored fields, and performs a single
atomic conditional task update. In the same transaction it records a new
restored snapshot and an activity entry. A stale version returns 409 without
changing the task or adding history. No automatic retry of writes.

The Task Details modal provides a field-by-field comparison of the chosen
snapshot with the current task, a confirmation prompt before restoration,
clear conflict/error states, and a disabled Restore action while unsaved
detail edits exist. Successful restore updates the dashboard task in memory
and closes the modal.

SQLite and PostgreSQL each receive an additive migration for the new table
and composite account/task/id index. The PostgreSQL startup migration guard
explicitly allows only the reviewed new migration. Existing task records and
their seven production rows are untouched during development or testing.
The snapshot table's account FK cascades on account deletion; it does not
cascade from task deletion so audit retention can be handled separately,
but snapshots of deleted tasks remain inaccessible through the task API.

Limits: the feature does not restore deleted task identities. Content-hash
versions detect current-content changes but not an ABA edit sequence that
returns all fingerprinted fields to identical values. Existing unguarded
legacy writes remain backward-compatible.
