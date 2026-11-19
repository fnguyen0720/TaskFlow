# TaskFlow browser regression

Playwright runs the real Vite/React frontend against a **local mocked API**. All intercepted API requests use the same-origin `/mock-api` URL, so these tests never create real accounts, access Render, or modify production tasks.

## Run locally

From the repository root:

```sh
cd frontend && npm ci
cd e2e && npm install --no-package-lock
npx playwright install chromium
npm test
```

Playwright automatically starts Vite on 127.0.0.1:5173, sets `VITE_API_URL` to the local mock URL, and stops the server afterward. Stop any existing Vite server on port 5173 before running if it was configured against another API. Screenshots and traces are retained on failure.

Coverage: bad and valid login; registration UI; task creation; weekly navigation; calendar quick-add; keyboard-operable Move and Undo; drag-and-drop and Undo; 320px mobile controls. Each test gets its own isolated, in-memory API data and a pinned browser clock.

**Scope:** This suite verifies browser flows and frontend-to-API request contracts under deterministic responses. It does **not** prove backend Identity integration, PostgreSQL persistence, deployed CORS, or actual screen-reader announcements. Those remain separately tested in backend CI and staging smoke tests. The native date picker is driven via Playwright's `selectOption` to avoid OS-specific key behavior.

The runner version is pinned in `package.json`; the E2E package intentionally keeps its dependency installation separate from the production frontend lockfile.
