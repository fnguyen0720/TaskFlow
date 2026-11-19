# PR #20: Notification center and daily focus

## User experience
The dashboard has a notification bell with an unread count and a scrollable list of reminders. Active notifications are derived from the authenticated user's tasks, on the **local browser calendar day**:

- **Overdue**: incomplete task with an earlier due date, even if its reminder is off.
- **Due today**: incomplete task due today, even if its reminder is off.
- **Coming up**: incomplete future task whose explicit `ReminderDaysBefore` window has begun.

A task appears at most once, in the highest-priority applicable category. Read and dismiss buttons persist independently for each task and notification kind. **Mark all read** updates every visible unread item. Dismissed items stay out of the list for the same kind; if a task crosses from upcoming to due-today or overdue, the new category is a separate notification. Completing or deleting a task removes its active alert, and deleting a task cascades its notification-state records.

The daily focus panel highlights open overdue, due-today, next-seven-days and recurring counts, with up to four actionable tasks in urgency/due-date order. Clicking a task opens its details. No background delivery, email, mobile push, or third-party tracking service is introduced.

## Security
`GET /api/notifications/state` returns only the authenticated user's state records. `PUT /api/notifications/state/{taskId}/{kind}` validates the fixed category/action taxonomy and verifies **the task belongs to the current authenticated user** before writing state. The API never takes a `UserId` from the request. The table stores only a user key, task key, notification category, read flag and dismissed flag—not titles, notes or message bodies. All endpoints require authentication; unauthorized users cannot read or alter another user's records. State is persisted on the server, not in shared localStorage.

## Database and release
Adds `TaskNotificationStates` with composite primary key `(UserId,TaskId,Kind)` and a cascading task foreign key. SQLite and PostgreSQL migrations are additive. The existing Render production startup guard explicitly permits **only** the known recurrence and notification migrations. Its prerequisite is still the existing task-details migration; unexpected pending migrations abort startup. It migrates before serving requests. Prior API releases remain compatible with the extra table. Do not run down migrations merely to roll back an API deploy, because dropping the table discards user preferences.

Test: `cd frontend && npm test && npm run lint && npm run build`, backend tests and disposable PostgreSQL integration, Playwright browser suites. After a merge, verify Render deployment, production schema, and all smoke probes.
