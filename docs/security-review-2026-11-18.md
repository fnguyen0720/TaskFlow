# TaskFlow dependency and security review — November 18, 2026

This review summarizes automated package scanning and selected source-code observations. It is **not a penetration test** or a claim that the application is free of security flaws.

## Package audit results

| Scope | Finding | Interpretation |
|---|---|---|
| Frontend, all dependencies | 5 high-severity npm findings | All reported findings trace to development/build tooling, chiefly picomatch and dependent packages |
| Frontend, production-only (npm audit --omit=dev) | 0 reported findings | No known advisories in the production npm dependency set from the configured audit source |
| Backend API NuGet packages | No vulnerable packages reported | Includes transitive dependencies, using NuGet's configured sources |
| Backend test NuGet packages | No vulnerable packages reported | Includes transitive dependencies |

These results are point-in-time findings and depend on advisory coverage.

### Changes made

- Refreshed the frontend lockfile within existing package-version ranges.
- Updated Vite's installed version to **8.3.8** and source-map-js to **1.2.2**, among other compatible dependency updates.
- Kept the existing Vite major version, avoiding the breaking downgrade proposed by `npm audit fix --force`.
- Added GitHub Actions dependency checks for frontend npm packages and backend NuGet packages, plus backend integration tests.
- Enforced `npm audit --omit=dev --audit-level=high` to fail CI on production npm advisories. The full npm advisory report is retained for visibility.

### Known unresolved advisory

**GHSA-fc5q-39xc-vjpf / CVE-2026-112366** affects picomatch through 4.0.7. As of November 18, 2026, no patched release is identified in the advisory. It is a regular-expression denial-of-service issue involving crafted extended-glob patterns.

The repo uses picomatch transitively within build/development tooling (through the Vite toolchain). Because `npm audit` counts dependent packages as metavulnerabilities, the full npm audit still reports high-severity findings. It does not indicate that five independent issues exist in application runtime code.

**Temporary disposition:** retain the current Vite major version and monitor for a patched picomatch/transitive dependency release. Do not use `npm audit fix --force` blindly: npm proposed downgrading Vite to 6.2.7, which is a breaking change and not a justified mitigation. Re-evaluate when a supported fix is available.

Reference: https://github.com/advisories/GHSA-fc5q-39xc-vjpf

## Source review and next hardening targets

- **Task ownership:** API GET/PUT/DELETE endpoints use authorization and filter database lookups by the authenticated user's ID. POST assigns ownership server-side rather than trusting a submitted user ID.
- **Input validation:** Task titles and priorities are checked server-side. Consider limiting the accepted category vocabulary/length, and add tests for oversized or unexpected values.
- **CORS preview origins:** The backend currently accepts any HTTPS `task-flow-*.vercel.app` origin in addition to configured origins. Replace broad prefix matching with explicitly trusted deployment hostnames or an owner-controlled preview-domain suffix. Coordinate with Render environment configuration before changing this policy so preview testing is not broken.
- **Authentication controls:** The source does not configure application-specific rate-limiting middleware around registration and login. Review rate limits, lockout policy, logging, and automated abuse protection before promoting the app for broad public use.
- **Token storage:** The frontend stores bearer tokens in localStorage, increasing the impact of any client-side XSS. Maintain strict avoidance of untrusted HTML, review content-security-policy feasibility, and consider safer session patterns for future versions.

## Validation and operational notes

The frontend CI pipeline runs installation, unit tests, build, and lint. Backend integration tests run in the security workflow. Vercel preview and dedicated-account smoke tests remain required for user-visible changes.

This review does **not** authorize modifying production database content, changing authentication secrets, or automatically deploying backend hardening. New security-relevant changes should be tested and reviewed in their own pull requests.
