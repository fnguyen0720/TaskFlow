# PostgreSQL API integration tests

This suite runs the real ASP.NET Core Minimal API + Identity + EF Core against **disposable local PostgreSQL**. Unlike the frontend Playwright suite, it does not mock the backend or database. The web host uses ASP.NET Core's in-memory test server, so there is no public port for the API.

## Safe connection requirements

The tests **refuse to start** unless `TASKFLOW_INTEGRATION_POSTGRES` points to a local database named `taskflow_integration` with username `taskflow_test`. This is a strict isolation guard; never use Render credentials or any shared database.

For example, with PostgreSQL running locally:

```sh
export TASKFLOW_INTEGRATION_POSTGRES='Host=127.0.0.1;Port=5432;Database=taskflow_integration;Username=taskflow_test;Password=YOUR_LOCAL_TEST_PASSWORD'
dotnet test backend/TaskFlow.Postgres.Tests/TaskFlow.Postgres.Tests.csproj
```

GitHub Actions starts a fresh `postgres:18` service container, applies the **actual PostgreSQL migrations** through `PostgreSqlTaskDbContext`, verifies schema history and non-null notes/checklist columns, and runs authentication and task lifecycle tests. The database is discarded after the job.

Coverage includes bearer-token authorization, real user registration/login, per-user task isolation, create/edit/details/checklist/toggle/delete persistence, guarded calendar rescheduling, stale-write conflict handling, and Undo as the reverse guarded PATCH.

Frontend UI behavior (clicking Undo and keyboard rescheduling) is already covered in the separate Playwright browser regression suite using an API mock. This suite checks the matching real API contract. Combining all three tiers under one browser test is a future enhancement.
