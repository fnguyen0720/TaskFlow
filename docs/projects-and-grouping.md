# TaskFlow Projects & Task Grouping (PR #51)

Projects are optional **account-owned** task groups, separate from existing categories,
filters, recurrence, reminders and task details. Existing tasks remain ungrouped because
the schema change only adds a nullable `Tasks.ProjectId` column and creates a new
`TaskProjects` table. No existing task records are backfilled or rewritten.

## API

- `GET /api/projects`: only projects owned by the authenticated account.
- `POST /api/projects`: create an account-owned named project (1–70 chars).
- `PUT /api/tasks/{id}/project`: move a task to a project or remove assignment
  with `{ "projectId": null }`. Requires a quoted current task `If-Match`
  fingerprint; a stale task returns 409 and a missing or cross-account
  task/project returns 404. The server ignores any client-supplied owner.
  Successful moves append an activity event and new task-history snapshot in
  the same database transaction.

Projects do not have a destructive delete endpoint in this release. Recurring
task occurrences preserve project association. Historical snapshots include
the project ID; restoring a snapshot checks that the referenced project still
belongs to the account before applying it.

## UI and safety

A project shelf shows counts and completion progress, includes All projects and
No project views, and allows creating projects. The project selection filters
the existing task view but never hides or deletes tasks in the database.
Task Details supports guarded project assignment. Pending unsaved details block
assignment, preventing accidental loss of drafts. Account changes reset the
selected project and abort old project reads.

This migration is additive, explicitly allowlisted at startup, and covered by
SQLite API and disposable PostgreSQL integration testing. All production
verification must be read-only; never seed production task or project data.
