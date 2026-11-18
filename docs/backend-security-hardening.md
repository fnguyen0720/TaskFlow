# Backend security and deployment notes

This change set strengthens the ASP.NET Core API without modifying existing task routes or database migrations.

## Authentication throttling

ASP.NET Core Identity API endpoints remain at their original URLs, including `/register` and `/login?useCookies=false`. An endpoint-group rate-limiting policy allows **20 Identity API requests per 60-second fixed window** per observed connection IP, without queuing. Excess requests receive **HTTP 429** with a `Retry-After: 60` header.

The limit applies to the Identity API endpoint group (including token refresh and account-management endpoints), not to task CRUD. The in-memory rate limiter resets when the API instance restarts and does not share counters between multiple API instances.

**Trusted Render public-edge client IP (opt-in):** The rate limiter uses the socket connection address by default. On a Render **public web service**, set `Security__TrustRenderPublicEdgeClientIp=true` to partition on Cloudflare's `CF-Connecting-IP` header. This mode requires `ASPNETCORE_ENVIRONMENT=Production`, `RENDER_SERVICE_TYPE=web`, and a non-empty Render-provided `RENDER_SERVICE_ID`. Render documents that Cloudflare overwrites this header before requests reach public services. This trust model **does not apply** to Render private services or any deployment that bypasses Render's public edge. Never enable this mode for those deployments, and never use the first caller-controlled `X-Forwarded-For` entry.

The trusted header must contain **exactly one valid IP address**; missing, duplicated, or malformed values fall back to the socket connection IP. The fallback is conservative and may group multiple users behind a proxy; it does not let clients invent arbitrary buckets.

**Staging-only diagnostics:** Set `Security__LogAuthBucketTags=true` **only on the isolated staging service** while validating independent clients. Logging occurs only if the trusted public-edge mode is active. It writes an ephemeral per-process **HMAC bucket tag** and a source label (`trusted-edge` or `connection-fallback`), never a raw IP or header value. Disable diagnostics before the production rollout. Tags change on restart and cannot be correlated across instances.

**Required acceptance:** Test from two genuinely different client networks. Exhaust Client A's auth budget and confirm Client B can still authenticate. Also verify a forged `CF-Connecting-IP` supplied over the **public Render URL** is overwritten at Render's edge and cannot bypass Client A's throttle. A unit test that injects an edge header inside the app proves the partitioning algorithm only; it does **not** prove the edge's overwrite behavior.

**Residual considerations:** In-memory counters reset when instances restart and are not shared between replicas; use a distributed limit store for multiple instances. The current 20/minute limit covers all ASP.NET Core Identity endpoints, so set thresholds based on actual usage and monitor for false positives.

References:
- https://render.com/articles/host-pocketbase-on-render
- https://render.com/docs/environment-variables
- https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0

## CORS: exact trusted origins only

The API now allows only explicitly configured browser origins:

- `https://task-flow-pi-lake.vercel.app` is included in `appsettings.json` as the default production frontend.
- The existing `FrontendUrl` configuration value is still accepted, for compatibility with the current Render service configuration.
- `http://localhost:5173` is allowed only when the backend is running in the **Development** environment.
- Additional exact origins can be configured with `Cors__AllowedOrigins__1`, `Cors__AllowedOrigins__2`, and so on as Render environment variables.

For example, to test an approved deployment preview, add:

```text
Cors__AllowedOrigins__1=https://task-flow-git-feature-backend-security-hardening-<exact-deployment>.vercel.app
```

Replace the example with the **real preview origin**, including the scheme and domain but no trailing path. Update and redeploy/restart the Render API so it picks up the setting. Remove old preview origins after the PR is merged. Never use `*.vercel.app` or untrusted preview-domain wildcards.

The server validates allowed-origin configuration and rejects invalid or non-HTTPS origins (except local HTTP during Development). Unlisted origins receive no `Access-Control-Allow-Origin` response header.

CORS controls which browser origins may read API responses; it does not replace authentication or authorization and is not a network firewall. Requests without an `Origin` header may still reach the API and must be authenticated as appropriate.

## Task validation and payload ownership

Creating and editing tasks both enforce the same input rules:

- Title must not be blank and cannot exceed **100 characters after trimming**.
- Priority must be **Low, Medium, or High**.
- Category must be **General, Work, Study, or Personal**.
- New tasks always start incomplete. Clients cannot choose their database ID or owner UserId.

Existing database records are unchanged by this PR. Validation affects only incoming create/edit requests.

## Rollout checklist

1. CI: run backend tests, including CORS, rate-limit, and validation coverage.
2. Deploy API to an isolated/staging environment if available. Backend changes do **not** automatically deploy to Vercel frontend previews.
3. Confirm login, registration, task CRUD and CORS from production and any approved preview origins.
4. Confirm repeated login attempts return 429 and legitimate traffic works normally from expected network routes.
5. Configure `Security__TrustRenderPublicEdgeClientIp=true` only after confirming public-Render edge behavior; enable temporary HMAC bucket-tag diagnostics in staging to distinguish two independent clients; verify a forged public-request header cannot change a rate-limit bucket.
6. Merge and deploy only with explicit authorization. If a staging backend is unavailable, clearly document the limits of preview testing.
