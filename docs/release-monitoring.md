# TaskFlow release checks and monitoring

This deployment check runs against the public production frontend and API. It **never registers, signs in, creates tasks or writes to PostgreSQL**.

## Checks

- `GET /` on Vercel must return 200 and a React mount point.
- `GET /health/live` on Render must return 200 with `{"status":"alive"}`.
- `GET /health/ready` must return 200 with `{"status":"ready"}` only if the configured database is reachable; a failed database check yields 503 with no internal details.
- Unauthenticated `GET /api/tasks` must return 401.
- A CORS preflight for the Vercel production origin must return 204 and the exact `Access-Control-Allow-Origin` header.

Probes are idempotent and do not require secrets or user credentials. The readiness endpoint only tests database connectivity, not whether all migrations are applied; migration correctness remains covered by PostgreSQL integration CI.

## When monitoring runs

The GitHub Actions workflow `Production smoke and uptime monitoring` runs hourly (at :17 UTC), on relevant pushes to `main`, manually via **Actions → Production smoke and uptime monitoring → Run workflow**, and when GitHub reports a successful production deployment status. Provider deployment-status events are not guaranteed; the periodic check is the independent fallback.

Each probe retries for up to 15 attempts, separated by 15 seconds, with 12-second per-request timeouts to accommodate cold starts and staggered deployments. A workflow failure indicates a sustained problem, not necessarily a specific root cause. Results and latency estimates appear in the GitHub Actions job summary. GitHub Actions failure notifications depend on the repository owner's notification preferences; no paging/SMS service is configured.

## Incident response

1. Open the failed GitHub Actions run and identify the failed probe.
2. If frontend failed, inspect the latest Vercel production deployment and its build logs.
3. If liveness failed, inspect the Render web service deploy, logs and restarts.
4. If readiness failed but liveness passed, inspect PostgreSQL availability, Render backend logs, DB connection configuration and recent migrations. **Never post connection strings or credentials in issues/logs.**
5. If auth returned 200, review API authorization immediately. If CORS preflight failed, verify the trusted production origin configuration.
6. Once resolved, manually dispatch the workflow to verify recovery. Review any partial deployment and roll back using the hosting provider if necessary.

For local smoke-script testing, run `node --test scripts/smoke.test.mjs`. The unit tests use in-memory HTTP mocks and don't contact production. Avoid running `node scripts/smoke.mjs` until both updated frontend and backend deployments have completed, because the new readiness route is absent on older backend versions.

## Scope / limitations

This provides **GitHub Actions-based periodic monitoring**, not a high-frequency external uptime/paging SLA. Workflow schedules can be delayed. The probes don't attempt account login or mutate data. UI journeys are covered by Playwright CI using a mocked API and the real API/database by PostgreSQL integration CI.
