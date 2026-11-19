# Recurring tasks and in-app reminders

## Recurrence
Users can select **None**, **Daily**, **Weekly**, or **Monthly** when creating or editing a task. Recurrence requires a due date. Completing an open recurring task marks that occurrence complete and creates the next occurrence on the server, inside the same database transaction. The original remains in the completed history. Each new occurrence inherits title, category, priority, notes, reminder settings and checklist text; every checklist step starts unchecked. The backend performs a conditional completion update so simultaneous completion requests cannot generate duplicate occurrences. Reopening a completed occurrence does not remove the already-generated next occurrence.

Each occurrence is a normal, user-owned task. Deleting an occurrence deletes only that occurrence. Monthly recurrence advances by one calendar month using the current occurrence's date; for dates such as January 31, the next date is February 28 (non-leap year) and then March 28. This first version does not preserve an original end-of-month anchor or support custom recurrence rules.

## Reminders
Task dates use the user's browser-local calendar date. In-app reminders are available **on the due date**, **1 day before**, or **7 days before**. Tasks must have a due date. A reminder banner lists open tasks whose reminder date has arrived, including overdue tasks. Completing a task removes its reminder; a future recurring occurrence carries the configured reminder.

This version has **no background delivery, email, native notifications, or push service**. Reminders appear only while visiting the application, after tasks load. Browser time and system timezone control when a reminder is shown.

## Deployment
The feature adds nullable integer `ReminderDaysBefore` and non-null text `RecurrenceRule` with default `None` to `Tasks`. Both SQLite and PostgreSQL migrations are included. Existing tasks retain their behavior with `RecurrenceRule=None` and no reminder.

**Apply the correct database migration before deploying the new backend.** For the current Render PostgreSQL schema, the guarded, transactional SQL script is `scripts/migrations/20261119210001_recurring_tasks_postgres.sql`. Run it with a trusted PostgreSQL client against the verified `taskflow_db_v8k1` instance, using secure credentials outside the repository. Take a backup/snapshot first, inspect the script, and verify both new columns and the `__EFMigrationsHistory` row before merging PR #19. The deployed Render service auto-deploys commits merged into `main`, so merging before this step would introduce a schema mismatch. Do not deploy this code against an older production schema. Confirm the new PostgreSQL migration is recorded in `__EFMigrationsHistory`; check production backup and rollback procedures first. The migration is additive, and the down migration removes both columns (therefore losing schedule preferences). No migration is auto-applied by ordinary API startup.

Verification: `dotnet test backend/TaskFlow.Api.Tests/TaskFlow.Api.Tests.csproj`, `dotnet test backend/TaskFlow.Postgres.Tests/TaskFlow.Postgres.Tests.csproj` against a disposable local PostgreSQL database, `cd frontend && npm test && npm run lint && npm run build`.
