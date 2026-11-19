# Full-stack browser tests (real local API and PostgreSQL)

This test suite does **not** mock HTTP requests. GitHub Actions starts a disposable `postgres:18` service, applies migrations using the established PostgreSQL integration test project, starts the **real ASP.NET Core API** on loopback port 5143, and runs Playwright against Vite on port 5174.

Each test registers uniquely named `example.test` users in the temporary database, logs in through the actual ASP.NET Identity endpoints, and verifies that UI changes persist in PostgreSQL. The suite covers task creation, calendar Move/Undo across reload, and user data isolation. These users are discarded when the CI job exits; they are **never created on Render**.

Use `npx playwright test --config=playwright.real.config.js` from `frontend/e2e` only after starting the backend and database locally. See `.github/workflows/full-stack-browser.yml` for the exact setup and environment variables.

The mocked browser regression suite remains separate and fast. This suite checks the integration boundary the mocks cannot cover.

Security: do not replace the localhost API address with production, and do not use Render database credentials. The PostgreSQL integration project independently refuses remote/production DB targets. No production writes or secrets are involved.
