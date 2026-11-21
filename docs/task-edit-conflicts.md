# TaskFlow guarded task edits (PR #43)

TaskFlow includes a read-only `version` fingerprint in task JSON responses. New clients
send `If-Match: "<version>"` on PUT `/api/tasks/{id}/title` and PUT
`/api/tasks/{id}/details`. Missing headers remain accepted for backward
compatibility during rollout. A syntactically invalid If-Match is rejected (400).
A stale matching version returns 409, and a task not owned by the caller
continues to return 404 without exposing its contents.

The server computes the fingerprint from the persisted task fields and uses
an **atomic conditional update** that checks those fields still equal the
original snapshot. This protects guarded editors from a competing write
between the initial read and UPDATE without a new database column or a
production data migration. The response includes the new version.

Editors hold onto the version present **when the user opened the draft**.
A conflict keeps the user's draft editable and displays a distinct message.
Discarding the draft and reloading the latest task requires explicit confirmation.
Other network errors preserve the draft and permit retry. No write is retried
automatically.

**Scope and limits:** This is opt-in, content-based optimistic concurrency,
not a global revision counter. Legacy clients that omit If-Match can still
overwrite concurrent changes. ABA changes that revert every fingerprinted
field to the same value cannot be detected. Only title and details edits
are guarded by version preconditions in this release; date moves already
have an expected-date condition. A future separately reviewed release may
introduce a server-managed monotonic revision and extend guards to other
mutations. This implementation does not alter or delete production task records.
