# Notification Preferences — PR #21

## User experience

Authenticated users can open the notification bell and select **Preferences**.
They can independently enable or disable **overdue**, **due today**, and
**upcoming** notification categories. Changes immediately affect visible
notification items and unread counts only after the backend confirms they
were saved. Preferences persist across page reloads and across devices.
The underlying tasks, due dates, reminders and daily focus dashboard are
unchanged; disabled categories only hide notification-center alerts.

All categories start enabled for existing and new users. Preferences are
stored in a dedicated `NotificationPreferences` table keyed by the
authenticated Identity user ID. `GET /api/notifications/preferences`
returns saved values or defaults without creating a row;
`PUT /api/notifications/preferences` validates that all three flags are
present and updates only the current user's row. Neither API accepts a
user identifier from the request. Deleting an Identity account cascades
its preference row.

The frontend keeps preferences scoped to the current auth token, so a
previous account's settings are never displayed or applied to a new
account. If saving fails, the old settings remain active and an error is
shown. The preference state contains no task titles, notes, URLs,
user email addresses or message bodies.

## Email reminders: explicitly deferred

There is currently **no email sender, scheduler, background worker,
outbound provider, or verified delivery channel**. The settings UI
makes this explicit; it cannot opt a user into actual email delivery,
and it does not send messages. Future opt-in delivery requires a
verified sender identity, confirmed recipient addresses, per-user
timezone, delivery deduplication, unsubscribe, queue/retry policy,
provider configuration, cost limits, and dedicated authorization and
integration tests. Do not enable email delivery just by setting an
environment variable.

## Database rollout and recovery

The SQLite migration `20261120150000_AddNotificationPreferences` and
PostgreSQL migration `20261120150001_AddNotificationPreferencesPostgres`
are additive, with default-true boolean fields and a cascade FK to
`AspNetUsers`. The existing production startup migration gate
explicitly permits only this new PostgreSQL migration and the previously
approved migrations. It runs before HTTP startup, rejects unexpected
pending migrations, and verifies the schema is current afterward.
The old API can run against the extra table; an application rollback
should **not** drop the table.

Do not merge until backend, PostgreSQL, frontend and both Playwright
workflows pass. After merging, verify Render's deployment commit, the
migration ID in `__EFMigrationsHistory`, the new table, production
smoke probes, and Vercel's production deployment. Do not use real
account data in tests.
