# Task activity history — PR #44

TaskFlow records server-authored metadata for new task creation, successful
edits, completion, reopening, and due-date rescheduling. Activity entries are
written in the same database transaction as the mutation. A validation failure,
rejected edit conflict, or failed database transaction cannot create a phantom
success event. No user-entered title, description, notes, checklist item, email,
password or authentication token is stored in the event payload.

GET `/api/tasks/{id}/activity` requires authentication, proves task ownership
from the bearer token, and returns up to 50 newest events, deterministically
ordered by timestamp and event ID. It returns 404 for an absent or another
account's task. The frontend timeline is inside the task detail dialog,
supports a non-destructive retry, and clears old account responses on session
changes.

Both SQLite and PostgreSQL receive separate additive EF migrations creating
only `TaskActivities`, with a user foreign key and a composite lookup index.
Existing tasks are unchanged and **not backfilled with fictional events**:
their timelines begin with the first recorded post-deployment mutation. The
task ID is intentionally not a cascading foreign key to preserve audit rows
for future retention decisions; events remain inaccessible once a task is
deleted. Removing a user cascades audit rows with that account.

Release checks: run backend and PostgreSQL migration tests, full browser and
isolated Playwright tests, validate CI and Vercel status for the final PR head,
then merge and verify Render deployment and read-only production task counts.
Never add test records to the production database.
