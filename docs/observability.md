# TaskFlow observability and incident response

## What is recorded

API middleware emits structured *server-side* request completion events with **method**, **route template**, **status code**, **duration in milliseconds**, and a **32-character hexadecimal correlation ID**. It does **not** record full URLs, path values, query strings, bodies, tasks, usernames, bearer tokens, passwords, cookies, or stack traces. The `X-Request-ID` response header is available to the trusted browser origin through the CORS exposed headers list. Invalid/untrusted IDs are replaced with a new random ID.

The browser reports only fixed diagnostic enums to `POST /api/diagnostics/frontend`: codes `unexpected_js`, `unhandled_rejection`, `react_render`, `network_failure`, `api_failure`; areas `ui`, `authentication`, `tasks`, `calendar`, `details`, `deletion`; and a correlation ID. **No free-form error messages, URLs, stack traces, task content, browser storage, credentials, user identifiers, or full network payloads** are transmitted. The collector validates the enums and ID, responds 202 for valid events, rejects invalid events, and limits submissions per source IP to 12/minute. Frontend reporters send at most five unique event code/area pairs per minute and do not send from local development. Frontend errors are not persisted to the application database. Actual deployment logs follow the retention and access policies configured for Render.

A React error boundary provides a reload action rather than a blank page. HTTP 5xx and network failures are recorded; expected user-visible failures (401 credentials, 409 calendar conflict) are not treated as server incidents.

## Finding an incident

1. Open Render web-service logs and filter for `request_completed`, `frontend_diagnostic`, and HTTP 5xx.
2. Match `correlation_id` from a frontend diagnostic to the backend `correlation_id` to identify the endpoint template and response status. A browser can also obtain `X-Request-ID` from the corresponding HTTP response.
3. For uptime problems, see `Production smoke and uptime monitoring` in GitHub Actions. Follow `docs/release-monitoring.md` for health, CORS, Render and Vercel checks.
4. Avoid copying request bodies or credentials into logs/issues, and do not enable full payload capture when investigating an incident.

## GitHub incident alert automation

`.github/workflows/production-failure-alerts.yml` listens for completion of `Production smoke and uptime monitoring` on `main`. A failed smoke run creates one deduplicated GitHub issue titled `[TaskFlow monitoring] production smoke failure`. Continued failures leave that issue open instead of creating repeated notifications. The first subsequent successful smoke check comments with the recovery run and closes the issue. PR smoke runs and cancelled workflows do not create incidents. The workflow requires `issues: write` but never executes untrusted code or downloads artifacts from the monitored run.

GitHub issue and Actions notification delivery depends on repository subscription and account notification settings. **This is not a paging/SMS integration.** Periodic checks can be delayed and the GitHub Actions platform itself can fail. Configure additional external alerts if strong response-time guarantees are needed.

## Local verification

```sh
cd frontend && npm ci && npm test && npm run lint && npm run build
dotnet test backend/TaskFlow.Api.Tests/TaskFlow.Api.Tests.csproj
# with local disposable PostgreSQL service configured:
dotnet test backend/TaskFlow.Postgres.Tests/TaskFlow.Postgres.Tests.csproj
```

No additional frontend tracking service, account, API key or browser cookie is necessary.
