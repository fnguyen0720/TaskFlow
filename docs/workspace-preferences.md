# Workspace preferences — PR #48

TaskFlow provides two lightweight browser-only settings:

- **Task list density:** comfortable (default) or compact. Compact mode reduces spacing without shrinking mobile task controls below touch-friendly sizes.
- **Default view after sign-in:** All tasks, Today, Upcoming, Calendar, or Unscheduled. This applies when signing in; changing it does not switch views immediately or discard an in-progress edit.

Settings are stored in this browser only. They are **not synchronized across devices**, and this release introduces no database migrations or new server-side preference writes. The verified account email is normalized and hashed using browser SHA-256 to form a localStorage key, so raw email addresses are not written into storage keys or preference values. This hash is a namespace, not an authentication secret; browser users can still inspect local data.

On every session change, the current task filters, search, sort, and preference dialog reset. No stale account preference is displayed while account identity is unverified. If storage is blocked, saving fails visibly without pretending the change was persisted. Invalid or corrupted preference values revert to safe defaults. Existing task and notification settings are preserved.

Regression tests use mocked login and account endpoints in isolated Playwright browser sessions; they do not create or update production task records. They exercise persistence, per-account isolation, keyboard operation, narrow viewports, and task retention.
