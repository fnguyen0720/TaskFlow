# TaskFlow

**A production-deployed, AI-powered full-stack task and project management application** built with React, ASP.NET Core (.NET 10), Entity Framework Core, and PostgreSQL.

TaskFlow supports daily task planning, project organization, recurring work, deadline visibility, and reliable task editing across devices. It is also an engineering portfolio project focused on secure multi-user APIs, database migrations, automated testing, and production operations.

**[Launch TaskFlow](https://task-flow-pi-lake.vercel.app)** · **[Try the zero-signup demo](https://task-flow-pi-lake.vercel.app/?demo=1)** · **[Source code](https://github.com/fnguyen0720/TaskFlow)**

## Engineering at a glance

- **Applied AI:** OpenAI Responses API, strict structured JSON outputs, server-side validation, explicit consent, editable human-reviewed task proposals, and transactional creation.
- **Secure backend:** ASP.NET Core Identity, account-scoped authorization, rate limiting, concurrency checks, and audit/version history.
- **Product engineering:** responsive React UI, accessible controls, installable online-only PWA, and isolated zero-signup interactive demo.
- **Quality and delivery:** xUnit integration tests, frontend unit tests, Playwright end-to-end regression tests, GitHub Actions CI/CD, and production smoke checks.

### Selected implementation milestones

| Feature | Pull request |
| --- | --- |
| Task dependencies and nested subtasks | [#55](https://github.com/fnguyen0720/TaskFlow/pull/55) |
| Opt-in AI bottleneck explanations | [#64](https://github.com/fnguyen0720/TaskFlow/pull/64) |
| Isolated interactive demo | [#73](https://github.com/fnguyen0720/TaskFlow/pull/73) |
| Structured AI task breakdown | [#76](https://github.com/fnguyen0720/TaskFlow/pull/76) |
| AI planner UX and created-task navigation | [#77](https://github.com/fnguyen0720/TaskFlow/pull/77), [#78](https://github.com/fnguyen0720/TaskFlow/pull/78) |
| AI Daily Focus recommendations | [#79](https://github.com/fnguyen0720/TaskFlow/pull/79) |

## Preview

| Dashboard | Authentication |
| --- | --- |
| ![Task dashboard](docs/images/taskflow-dashboard.png) | ![Sign-in screen](docs/images/taskflow-login.png) |

> Screenshots may not show the latest UI. The live app contains the current feature set. Use the interactive demo without an account, or create an account to explore your private workspace.

## Interactive demo (no signup)

Choose **Try interactive demo** on the sign-in screen or open [the demo link](https://task-flow-pi-lake.vercel.app/?demo=1). It loads a **separate, in-memory React workspace** with example tasks. You can add, complete, edit, delete, search, and schedule tasks using week/month calendars. Reset the demo at any time.

- Demo state lives only in the current React session and is **not** saved to localStorage, cookies, PostgreSQL, or the API.
- Reloading or leaving the demo discards all demo changes; exiting returns you to the normal login/register experience.
- Existing sign-in sessions and real account task records are not touched.
- The demo intentionally focuses on basic task planning. Account-backed projects, reminders, history, AI coaching, and other server features require a real account.
- Playwright regression tests reject networked demo actions and verify isolation, mobile layouts, and unchanged sign-in behavior.

## What you can do

### Organize tasks and projects
- Create, edit, complete, and delete tasks; undo accidental deletion during the short recovery window.
- Assign priorities, categories, due dates, notes, and checklist items.
- Link tasks to prerequisite tasks. Incomplete prerequisites block completion, and circular or cross-account dependencies are rejected by the API.
- Organize richer checklist subtasks with one level of nesting, individual priority and due date, completion status, and stable identifiers.
- Create and rename private projects, see project progress, filter by project, and move tasks between projects.
- Create a task directly inside the currently selected project; ungrouped tasks remain supported.
- Search, sort, and filter work by status, schedule, category, and project.
- Use All, Today, Upcoming, Unscheduled, and calendar views; view dashboard statistics and current-snapshot productivity insights.

### Plan and navigate
- Schedule recurring tasks and manage reminder and notification preferences.
- Use weekly and monthly calendars, including drag-and-drop scheduling in the week view and accessible date-based moves.
- Open the command palette with **Ctrl/⌘ + K** to search and navigate quickly.
- Use a responsive mobile layout, keyboard-friendly dialogs, accessible focus states, and an installable **online-only PWA**. Offline task editing and synchronization are **not** supported.

### Productivity intelligence
- Inspect seven-day upcoming deadlines, priority mix, 30-day recorded completion events, and owner-scoped dependency bottlenecks.
- The deterministic Bottleneck Coach works without an AI provider. The optional AI explanation sends **only aggregated numeric metrics and a server-validated insight code** to OpenAI after the user explicitly checks consent and requests an explanation. Task titles, descriptions, notes, task IDs, and account details are not sent.
- AI output is advisory text only: it does not create, edit, reschedule, complete, or delete tasks. Rule-based recommendations remain available if inference is offline.

#### Optional AI coaching configuration (API server only)

AI explanations are **disabled by default**. To enable them, set these environment variables on the API backend service (not Vercel/frontend):

```text
AiCoach__Enabled=true
OPENAI_API_KEY=<server-side-secret>
AiCoach__Model=gpt-4o-mini
```

The model name is configurable; verify the chosen model supports the Responses API in your account. Never commit or expose the API key. Each request has a 15-second timeout, a bounded output limit, `store: false`, and a five-requests-per-ten-minutes network bucket. Availability is reported separately, and no provider call is made until the signed-in user opts in. API usage can incur charges and needs operator budget controls. No persistence of AI answers is implemented.

### AI Daily Focus (opt-in)

The **Plan my day** panel is collapsed by default, and never automatically contacts a model or modifies tasks. Signed-in users can choose to send **up to 15 unfinished task titles, priorities and due dates** to OpenAI. The server selects the candidates exclusively from the authenticated account, omitting notes, checklists, email addresses, and account identifiers. The AI returns up to five short recommendations explaining why those tasks are worth tackling. A user can open the corresponding task or ignore the suggestions.

- Requires explicit consent each time the user opts in; the generation endpoint rejects unauthenticated or unconsented requests.
- Suggestions are **read-only and transient**; no changes are made to task records or dates, and no new migration is required.
- Provider recommendations must reference unique IDs from the account-scoped candidate shortlist; invented or malformed IDs fail validation.
- Uses the existing server-only OpenAI configuration (`AiCoach:Enabled`, `OPENAI_API_KEY`, `AiCoach:Model`) and shared AI request-rate limiter. Generation is unavailable when the model is disabled.
- No private data is sent from the zero-signup demo. The feature's outputs are advisory, not a promise of completion times or automated scheduling.

### AI Task Breakdown (opt-in)

Signed-in users can expand **AI task breakdown**, type a goal, and explicitly consent to send **only that goal text** to OpenAI. The backend returns up to eight suggested tasks using a strict structured JSON schema, with bounded titles, categories and priorities. This request makes **no database writes** and does not send stored tasks, private notes, account details, or task identifiers to the provider.

The AI UI keeps the workspace uncluttered with a collapsed entry point and three focused steps: **Goal → Review → Created**. Users can start from example goals, view their selection count, select or clear all suggestions, edit their goal before saving, and receive clear post-save confirmation and navigate directly to the newly created tasks.

The suggestions appear in an editable review screen. Users may rename, reprioritize, change categories, deselect items, and choose an owned project. A separate **Create selected tasks** action requires confirmation; the server revalidates every edited item, verifies the project belongs to the signed-in user, and writes all selected tasks, initial version snapshots and activity entries within one transaction. Invalid or cross-account submissions create nothing. No AI model can autonomously create tasks.

The feature reuses the existing server-only `AiCoach__Enabled`, `OPENAI_API_KEY` and optional `AiCoach__Model` configuration. It remains disabled when inference is unconfigured, never appears in the zero-signup demo, and has no new migrations. Generation is subject to the existing AI rate limit (five requests per ten minutes per configured connection-IP bucket). AI usage can incur provider charges. No generated plan is persisted unless the user separately approves its selected tasks. As with ordinary task creation, repeated *separate* confirmed submissions can create additional tasks; do not blindly retry after a network failure.

### Progression and achievements
- Earn 25 XP for the **first recorded completion of each distinct task**; reopening and completing it again never awards more XP.
- Level up through cumulative XP thresholds and unlock permanent First Step, Getting Things Done, and Task Master achievements.
- The optional Seven-day Quest tracks progress on five different task completions during the most recent seven UTC days. It is a rolling challenge, **not** a punitive daily streak.
- Project Quests turn existing private projects into progress objectives (completed/total tasks) without awarding extra XP; empty projects are not falsely marked complete. Up to 20 projects are shown in the dashboard quest view.
- Progress is a read-only authenticated aggregate of server-recorded events. There is no user-editable XP counter, leaderboard, reward purchase, migration, or automatic task change.
- Tasks completed before activity tracking began are not backfilled; deleted tasks retain past earned credit. Users can collapse the achievement details to minimize distractions.

### Edit with confidence
- Preserve unsaved task drafts across many navigation and save-failure scenarios; show clear retry and discard options.
- Detect stale edits and reject conflicting writes rather than silently overwriting newer task data.
- View a private activity timeline for task changes.
- Compare historical task snapshots and restore a previous version with confirmation and conflict checks.
- Load larger workspaces using bounded API pagination and incremental list rendering.
- Verify signed-in account identity and distinguish loading failures from genuinely empty workspaces.

### Account and security features
- Account registration, sign-in, sign-out, and authenticated Bearer-token API requests.
- ASP.NET Core Identity, owner-scoped queries, and backend ownership validation for tasks, projects, history, and preferences.
- Input validation, rate limiting on identity endpoints, and explicit trusted-origin CORS configuration.
- Provider-gated password recovery and email verification interfaces. **Email delivery and public recovery availability depend on verified operator configuration; do not assume they are enabled.**
- In-app notification center with configurable overdue, due-today, and upcoming alerts.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, JavaScript, Vite, CSS |
| Backend | C#, ASP.NET Core Minimal APIs (.NET 10), ASP.NET Core Identity |
| Data | Entity Framework Core, SQLite (local), PostgreSQL (production) |
| Applied AI | OpenAI Responses API, structured JSON schema, consent-gated inference, output validation |
| Testing | xUnit API/integration tests, frontend unit tests, Playwright browser tests |
| Delivery | GitHub Actions CI, Vercel (frontend), Render (API and PostgreSQL) |
| Operations | Production smoke checks, synthetic latency sampling, security/dependency audits, documented recovery procedures |

## Architecture

```text
Browser / installable online-only PWA
              |
              | HTTPS + Bearer token
              v
React + Vite frontend (Vercel)
              |
              | authenticated REST requests
              v
ASP.NET Core Minimal API (.NET 10) (Render)
   | ASP.NET Core Identity + owner checks
   | task/project/history/notification endpoints
   | consent-gated AI endpoints --> OpenAI Responses API
   v
Entity Framework Core
   |                     |
   v                     v
SQLite (local)      PostgreSQL (production)
```

The server—not the browser—establishes account ownership and validates cross-resource operations. PostgreSQL production changes use reviewed additive EF Core migrations and an explicit migration allowlist. The application is not a shared/team collaboration product; projects and task data are scoped to individual accounts.

## Engineering highlights

- **Concurrency safety:** conditional task updates and version-aware restoration detect stale writes. Dependency editing checks the previously observed links to prevent silent stale overwrites.
- **Account isolation:** authorization and ownership checks protect records across tasks, projects, dependencies, version history, activities, and settings.
- **Data preservation:** additive schema changes and tests prioritize retaining existing task records and compatible clients.
- **Resilience:** request cancellation/session guards, error recovery, preserved drafts, and explicit empty/loading/error states.
- **Testing:** API integration, PostgreSQL isolation, frontend unit, and Playwright browser regression suites run through dedicated GitHub Actions workflows.
- **Operations:** automated smoke checks and read-only synthetic latency measurements. A **disposable CI-only PostgreSQL dump/restore rehearsal** tests recovery logic; this is **not evidence that production backups are configured or verified**.

Task dependencies and advanced nested subtasks were introduced in [PR #55](https://github.com/fnguyen0720/TaskFlow/pull/55). The CI suites and read-only production smoke checks passed at merge; production task-count preservation was not independently verified.

Further implementation notes are in [docs/](docs/), including [projects](docs/projects-and-grouping.md), [version history](docs/task-version-history.md), [edit conflicts](docs/task-edit-conflicts.md), [recurring tasks](docs/recurring-tasks.md), [account recovery](docs/account-recovery.md), and [backup readiness](docs/backup-and-recovery.md).

## Run locally

### Prerequisites
- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js and npm](https://nodejs.org/)
- Git
- EF Core CLI (`dotnet-ef`) for database migrations

### 1. Clone

```bash
git clone https://github.com/fnguyen0720/TaskFlow.git
cd TaskFlow
```

### 2. Configure and start the API

Use the development connection-string and trusted frontend-origin settings described in `backend/TaskFlow.Api/appsettings.Development.json` and [backend security notes](docs/backend-security-hardening.md). Never commit real secrets.

```bash
cd backend/TaskFlow.Api
dotnet restore
dotnet ef database update --context TaskDbContext
dotnet run
```

Local development uses SQLite. Production uses the separate `PostgreSqlTaskDbContext` and a `TASKFLOW_POSTGRES_CONNECTION` value configured on the server. **Do not apply local-development commands or migrations to a production database.**

### 3. Start the frontend

In another terminal, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite. Match the frontend API base URL and backend CORS allowed origins to your local setup. Vercel preview origins must be explicitly permitted by the API when testing end to end.

## Test and verify

```bash
# From repository root: backend tests
dotnet test backend/TaskFlow.Api.Tests/TaskFlow.Api.Tests.csproj

# Frontend checks
cd frontend
npm ci
npm test
npm run lint
npm run build
```

Playwright browser suites and real PostgreSQL integration checks are also configured in `.github/workflows/`. See the relevant workflow definitions and `frontend/e2e/` for their execution commands and test environment requirements.

## Deployment and operational safeguards

| Component | Hosting |
| --- | --- |
| React web client | Vercel |
| ASP.NET Core API | Render |
| PostgreSQL | Render |

Runtime configuration is supplied via environment variables, not hardcoded production credentials. Production workflows include read-only smoke checks, failure alerting, and latency sampling. The recovery documentation clearly distinguishes test-only restore rehearsals from real production backup verification.

## Roadmap

- Improve task dependency and nested subtask usability, including progress visibility and more comprehensive browser coverage.
- Continue expanding accessibility and cross-browser regression coverage.
- Improve operational visibility and verify production backup practices.
- Extend performance and user experience for larger datasets.

## Author

**Felix Nguyen** · [GitHub](https://github.com/fnguyen0720) · [LinkedIn](https://www.linkedin.com/in/felix-nguyen-41abb2373/)
