# Recurring tasks and in-app reminders

## Recurrence
Users can select **None**, **Daily**, **Weekly**, or **Monthly** when creating or editing a task. Recurrence requires a due date. Completing an open recurring task marks that occurrence complete and creates the next occurrence on the server, inside the same database transaction. The original remains in the completed history. Each new occurrence inherits title, category, priority, notes, reminder settings and checklist text; every checklist step starts unchecked. The backend performs a conditional completion update so simultaneous completion requests cannot generate duplicate occurrences. Reopening a completed occurrence does not remove the already-generated next occurrence.

Each occurrence is a normal, user-owned task. Deleting an occurrence deletes only that occurrence. Monthly recurrence advances by one calendar month using the current occurrence's date; for dates such as January 31, the next date is February 28 (non-leap year) and then March 28. This first version does not preserve an original end-of-month anchor or support custom recurrence rules.

## Reminders
Task dates use the user's browser-local calendar date. In-app reminders are available **on the due date**, **1 day before**, or **7 days before**. Tasks must have a due date. A reminder banner lists open tasks whose reminder date has arrived, including overdue tasks. Completing a task removes its reminder; a future recurring occurrence carries the configured reminder.

This version has **no background delivery, email, native notifications, or push service**. Reminders appear only while visiting the application, after tasks load. Browser time and system timezone control when a reminder is shown.

## Production deployment and rollback

The feature adds nullable integer `ReminderDaysBefore` and non-null text
`RecurrenceRule` (default `None`) to `Tasks`. SQLite and PostgreSQL
migration files are included. Existing tasks remain non-recurring.

**The Render web service auto-deploys merges to `main`.** At **production
startup only**, the new API now performs an explicit, guarded PostgreSQL
schema expansion before starting its HTTP listener:

1. Check that the existing `20261119164957_AddTaskDetails` migration
   has already been applied. If not, abort startup.
2. Refuse to continue if any unexpected migrations are pending.
3. Apply the single approved `20261119210001_AddRecurrenceAndRemindersPostgres`
   migration using EF Core's transactional migration mechanism.
4. Verify no migrations remain pending. If migration or verification fails,
   abort startup instead of serving an API with an incompatible schema.

The migration is additive and backward-compatible with the previous API.
On subsequent restarts the check is idempotent. Existing task data is
preserved. The fallback manual script
`scripts/migrations/20261119210001_recurring_tasks_postgres.sql`
is provided for administrators who choose a migration-first operation; do
**not** apply it while another migration runner is active.

Before merging, check the Render database identity, prerequisite migration,
and a recoverable backup strategy. After deployment, confirm the migration
history, the columns, all five production smoke probes, and login/task
operations. If the deployment fails, roll back the web-service image to
the previous commit. **Do not run the down migration for an application
rollback:** the prior API works with the extra columns, and dropping them
would discard recurrence preferences.

The Render database may be on a plan without independently confirmed
point-in-time recovery or snapshot guarantees. Check the backup/restore
policy before making destructive future schema changes.

Verification: `dotnet test backend/TaskFlow.Api.Tests/TaskFlow.Api.Tests.csproj`,
`dotnet test backend/TaskFlow.Postgres.Tests/TaskFlow.Postgres.Tests.csproj`
against a disposable local PostgreSQL database, and
`cd frontend && npm test && npm run lint && npm run build`.
