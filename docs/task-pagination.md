# TaskFlow task-list pagination (PR #42)

The authenticated GET /api/tasks endpoint accepts **optional** integer query parameters `offset` and `limit`.
Both must be supplied together, offset must be nonnegative, and limit must be between 1 and 100.
Responses remain a JSON array for compatibility with existing clients. Requests without either
parameter return the complete list as before.

All pages are restricted by the authenticated owner's ID and retain the same order as the
legacy response: incomplete first, High/Medium/Low priority, dated before undated, earlier
due dates first, and task ID as a stable tie breaker. Invalid bounds are rejected with 400.

The dashboard requests pages of 100 until a short page completes; it does not treat a
successful early page as a complete snapshot. A failure on *any* page keeps totals
unverified and exposes a retry path. Session changes and overlapping reloads abort
stale requests, and no existing task records or database schema need migration.
The list initially renders 50 rows, adding 50 per click; global dashboard statistics,
search, category filters and sorting still use the complete verified list.

**Limitations:** This is a backward-compatible bounded transport and DOM-rendering
improvement, not server-side search, virtualization, or a transactionally consistent
cross-page snapshot. If tasks are created or deleted while a multi-page read is underway,
offset pagination can shift boundaries. A future larger-scale upgrade can use a
versioned keyset cursor and server-side filtered aggregates to solve that. No client
automatically retries writes, and no production test changes task records.
