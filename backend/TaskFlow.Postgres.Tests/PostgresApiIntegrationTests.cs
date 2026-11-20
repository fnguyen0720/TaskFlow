using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace TaskFlow.Postgres.Tests;

public sealed class PostgresApiIntegrationTests : IClassFixture<PostgresApiFactory>
{
    private readonly PostgresApiFactory _factory;

    public PostgresApiIntegrationTests(PostgresApiFactory factory) => _factory = factory;

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var payload = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync());
        return payload.RootElement.Clone();
    }

    private static async Task<JsonElement> GetTaskAsync(HttpClient client, int id)
    {
        using var response = await client.GetAsync("/api/tasks");
        response.EnsureSuccessStatusCode();
        var tasks = await JsonAsync(response);
        return tasks.EnumerateArray().Single(task => task.GetProperty("id").GetInt32() == id);
    }

    [Fact]
    public async Task ProductionMigrationGuard_IsIdempotentOnCurrentPostgresSchema()
    {
        // The test harness already applies the real migration to the isolated
        // PostgreSQL database. Production startup should safely accept that
        // schema and leave all migration state unchanged.
        await RecurringProductionMigration.EnsureAppliedAsync(_factory.Services);
        await RecurringProductionMigration.EnsureAppliedAsync(_factory.Services);

        using var client = _factory.NewClient();
        using var ready = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
    }

    [Fact]
    public async Task Recurrence_CreatesExactlyOneNextOccurrenceInPostgres()
    {
        using var owner = await _factory.AuthenticatedClientAsync();
        using var outsider = await _factory.AuthenticatedClientAsync();
        using var created = await owner.PostAsJsonAsync("/api/tasks", new
        {
            title = "Recurring integration", priority = "High", category = "Work",
            dueDate = "2026-11-19", recurrenceRule = "Weekly", reminderDaysBefore = 1
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var original = await JsonAsync(created);
        int id = original.GetProperty("id").GetInt32();

        using var denied = await outsider.PutAsync($"/api/tasks/{id}", null);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        using var complete = await owner.PutAsync($"/api/tasks/{id}", null);
        Assert.Equal(HttpStatusCode.OK, complete.StatusCode);

        using var fetched = await owner.GetAsync("/api/tasks");
        fetched.EnsureSuccessStatusCode();
        var matches = (await JsonAsync(fetched)).EnumerateArray()
            .Where(item => item.GetProperty("title").GetString() == "Recurring integration")
            .ToList();
        Assert.Equal(2, matches.Count);
        Assert.True(matches.Single(item => item.GetProperty("id").GetInt32() == id)
            .GetProperty("completed").GetBoolean());
        var next = matches.Single(item => item.GetProperty("id").GetInt32() != id);
        Assert.False(next.GetProperty("completed").GetBoolean());
        Assert.StartsWith("2026-11-26", next.GetProperty("dueDate").GetString());
        Assert.Equal(1, next.GetProperty("reminderDaysBefore").GetInt32());
        Assert.Equal("Weekly", next.GetProperty("recurrenceRule").GetString());

        using var outsiderList = await outsider.GetAsync("/api/tasks");
        Assert.DoesNotContain((await JsonAsync(outsiderList)).EnumerateArray(),
            item => item.GetProperty("title").GetString() == "Recurring integration");
    }

    [Fact]
    public async Task Recurrence_RejectsMissingDateAndInvalidOffset()
    {
        using var client = await _factory.AuthenticatedClientAsync();
        using var noDate = await client.PostAsJsonAsync("/api/tasks", new
        {
            title = "Invalid", priority = "Medium", category = "General",
            recurrenceRule = "Daily"
        });
        Assert.Equal(HttpStatusCode.BadRequest, noDate.StatusCode);

        using var badReminder = await client.PostAsJsonAsync("/api/tasks", new
        {
            title = "Invalid reminder", priority = "Medium", category = "General",
            dueDate = "2026-11-19", reminderDaysBefore = 999
        });
        Assert.Equal(HttpStatusCode.BadRequest, badReminder.StatusCode);
    }

    [Fact]
    public async Task NotificationPreferences_ArePrivateValidatedAndPersistInPostgres()
    {
        using var owner = await _factory.AuthenticatedClientAsync();
        using var other = await _factory.AuthenticatedClientAsync();
        using var anon = _factory.NewClient();

        using var anonymousRead = await anon.GetAsync("/api/notifications/preferences");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousRead.StatusCode);
        using var initial = await owner.GetAsync("/api/notifications/preferences");
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        var defaults = await JsonAsync(initial);
        Assert.True(defaults.GetProperty("overdueEnabled").GetBoolean());
        Assert.True(defaults.GetProperty("dueTodayEnabled").GetBoolean());
        Assert.True(defaults.GetProperty("upcomingEnabled").GetBoolean());

        using var missing = await owner.PutAsJsonAsync("/api/notifications/preferences",
            new { overdueEnabled = false });
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);

        using var saved = await owner.PutAsJsonAsync("/api/notifications/preferences",
            new { overdueEnabled = false, dueTodayEnabled = true, upcomingEnabled = false });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        using var ownerAgain = await owner.GetAsync("/api/notifications/preferences");
        var persisted = await JsonAsync(ownerAgain);
        Assert.False(persisted.GetProperty("overdueEnabled").GetBoolean());
        Assert.True(persisted.GetProperty("dueTodayEnabled").GetBoolean());
        Assert.False(persisted.GetProperty("upcomingEnabled").GetBoolean());

        using var otherResponse = await other.GetAsync("/api/notifications/preferences");
        var separate = await JsonAsync(otherResponse);
        Assert.True(separate.GetProperty("overdueEnabled").GetBoolean());
        Assert.True(separate.GetProperty("upcomingEnabled").GetBoolean());
        using var anonymousWrite = await anon.PutAsJsonAsync("/api/notifications/preferences",
            new { overdueEnabled = false, dueTodayEnabled = false, upcomingEnabled = false });
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousWrite.StatusCode);
    }

    [Fact]
    public async Task NotificationPreferencesMigration_IsAppliedAndRestartSafe()
    {
        using var scope = _factory.Services.CreateScope();
        var applied = await scope.ServiceProvider.GetRequiredService<TaskDbContext>()
            .Database.GetAppliedMigrationsAsync();
        Assert.Contains("20261120150001_AddNotificationPreferencesPostgres", applied);
        await RecurringProductionMigration.EnsureAppliedAsync(_factory.Services);
        await RecurringProductionMigration.EnsureAppliedAsync(_factory.Services);
    }

    [Fact]
    public async Task NotificationState_RequiresOwnerAndPersistsAcrossClients()
    {
        using var owner = await _factory.AuthenticatedClientAsync();
        using var other = await _factory.AuthenticatedClientAsync();
        using var created = await owner.PostAsJsonAsync("/api/tasks", new
        {
            title = "Private notification state", priority = "High", category = "Work",
            dueDate = "2026-11-19", reminderDaysBefore = 1
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var task = await JsonAsync(created);
        var id = task.GetProperty("id").GetInt32();

        using var anonymous = _factory.NewClient();
        using var anonymousResponse = await anonymous.GetAsync("/api/notifications/state");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousResponse.StatusCode);
        using var unauthorizedWrite = await other.PutAsJsonAsync(
            $"/api/notifications/state/{id}/due-today", new { action = "dismiss" });
        Assert.Equal(HttpStatusCode.NotFound, unauthorizedWrite.StatusCode);

        using var invalidKind = await owner.PutAsJsonAsync(
            $"/api/notifications/state/{id}/private-title", new { action = "read" });
        Assert.Equal(HttpStatusCode.BadRequest, invalidKind.StatusCode);
        using var invalidAction = await owner.PutAsJsonAsync(
            $"/api/notifications/state/{id}/due-today", new { action = "delete" });
        Assert.Equal(HttpStatusCode.BadRequest, invalidAction.StatusCode);

        using var read = await owner.PutAsJsonAsync(
            $"/api/notifications/state/{id}/due-today", new { action = "read" });
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var dismiss = await owner.PutAsJsonAsync(
            $"/api/notifications/state/{id}/due-today", new { action = "dismiss" });
        Assert.Equal(HttpStatusCode.OK, dismiss.StatusCode);
        using var repeated = await owner.PutAsJsonAsync(
            $"/api/notifications/state/{id}/due-today", new { action = "dismiss" });
        Assert.Equal(HttpStatusCode.OK, repeated.StatusCode);

        using var ownStates = await owner.GetAsync("/api/notifications/state");
        var own = (await JsonAsync(ownStates)).EnumerateArray()
            .Where(item => item.GetProperty("taskId").GetInt32() == id)
            .ToArray();
        var state = Assert.Single(own);
        Assert.True(state.GetProperty("isRead").GetBoolean());
        Assert.True(state.GetProperty("isDismissed").GetBoolean());

        using var otherStates = await other.GetAsync("/api/notifications/state");
        Assert.Empty((await JsonAsync(otherStates)).EnumerateArray());

        using var deleted = await owner.DeleteAsync($"/api/tasks/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        using var after = await owner.GetAsync("/api/notifications/state");
        Assert.DoesNotContain((await JsonAsync(after)).EnumerateArray(),
            item => item.GetProperty("taskId").GetInt32() == id);
    }

    [Fact]
    public async Task NotificationMigration_IsTrackedAndGuardedStartupIsIdempotent()
    {
        using var scope = _factory.Services.CreateScope();
        var applied = await scope.ServiceProvider.GetRequiredService<TaskDbContext>()
            .Database.GetAppliedMigrationsAsync();
        Assert.Contains("20261119230001_AddNotificationStatesPostgres", applied);
        await RecurringProductionMigration.EnsureAppliedAsync(_factory.Services);
        await RecurringProductionMigration.EnsureAppliedAsync(_factory.Services);
    }

    [Fact]
    public async Task HealthProbes_ArePublicAndPostgresReadinessIsHealthy()
    {
        using var client = _factory.NewClient();
        using var live = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal("alive", (await JsonAsync(live)).GetProperty("status").GetString());

        using var ready = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
        Assert.Equal("ready", (await JsonAsync(ready)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task RealPostgresMigrations_CreateTaskDetailsAndIdentityTables()
    {
        var connectionString = PostgresApiFactory.RequireLocalTestDatabase();
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT "MigrationId" FROM public."__EFMigrationsHistory"
            ORDER BY "MigrationId"
            """, connection);
        var applied = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync()) applied.Add(reader.GetString(0));
        }

        Assert.Contains("20261017154711_InitialPostgresCreate", applied);
        Assert.Contains("20261119164957_AddTaskDetails", applied);
        Assert.Contains("20261119210001_AddRecurrenceAndRemindersPostgres", applied);

        await using var columns = new NpgsqlCommand(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Tasks'
              AND column_name IN ('Notes', 'ChecklistJson')
              AND is_nullable = 'NO'
            """, connection);
        var found = new HashSet<string>();
        await using (var reader = await columns.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync()) found.Add(reader.GetString(0));
        }
        Assert.Contains("Notes", found);
        Assert.Contains("ChecklistJson", found);
    }

    [Fact]
    public async Task RealIdentity_RejectsAnonymousAndInvalidTokens_AndAllowsLogin()
    {
        using var anonymous = _factory.NewClient();
        using var rejected = await anonymous.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);

        // Exercise the real Identity login handler with a bad password, not a mock.
        using var badPassword = await anonymous.PostAsJsonAsync(
            "/login?useCookies=false", new
            {
                email = $"missing-{Guid.NewGuid():N}@example.test",
                password = "IncorrectPassword123!"
            });
        Assert.Equal(HttpStatusCode.Unauthorized, badPassword.StatusCode);

        using var owner = await _factory.AuthenticatedClientAsync();
        using var allowed = await owner.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        Assert.Empty((await JsonAsync(allowed)).EnumerateArray());

        using var invalidToken = _factory.NewClient();
        invalidToken.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", "invalid-token");
        using var denied = await invalidToken.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
    }

    [Fact]
    public async Task RealPostgresTaskLifecycle_RescheduleUndoAndOwnershipPersist()
    {
        using var owner = await _factory.AuthenticatedClientAsync();
        using var otherUser = await _factory.AuthenticatedClientAsync();

        using var created = await owner.PostAsJsonAsync("/api/tasks", new
        {
            title = "  Postgres lifecycle  ", priority = "Medium", category = "Work",
            dueDate = "2026-11-17", completed = true,
            userId = "not-the-owner"
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var task = await JsonAsync(created);
        int id = task.GetProperty("id").GetInt32();
        Assert.Equal("Postgres lifecycle", task.GetProperty("title").GetString());
        Assert.False(task.GetProperty("completed").GetBoolean());

        var endpoint = $"/api/tasks/{id}";
        using var invisible = await otherUser.GetAsync("/api/tasks");
        Assert.Empty((await JsonAsync(invisible)).EnumerateArray());
        using var forbiddenEdit = await otherUser.PutAsJsonAsync(endpoint + "/title", new
        {
            title = "Stolen", priority = "Low", category = "Work"
        });
        Assert.Equal(HttpStatusCode.NotFound, forbiddenEdit.StatusCode);

        using var edited = await owner.PutAsJsonAsync(endpoint + "/title", new
        {
            title = "Updated in PostgreSQL", priority = "High", category = "Personal",
            dueDate = "2026-11-17"
        });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);

        using var details = await owner.PutAsJsonAsync(endpoint + "/details", new
        {
            notes = "Persisted notes",
            checklist = new[] { new { text = "  Verify migrations  ", completed = true } }
        });
        Assert.Equal(HttpStatusCode.OK, details.StatusCode);

        using var completed = await owner.PutAsync(endpoint, null);
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);

        var stored = await GetTaskAsync(owner, id);
        Assert.True(stored.GetProperty("completed").GetBoolean());
        Assert.Equal("Updated in PostgreSQL", stored.GetProperty("title").GetString());
        Assert.Equal("High", stored.GetProperty("priority").GetString());
        Assert.Equal("Persisted notes", stored.GetProperty("notes").GetString());
        var checklist = stored.GetProperty("checklist").EnumerateArray().Single();
        Assert.Equal("Verify migrations", checklist.GetProperty("text").GetString());
        Assert.True(checklist.GetProperty("completed").GetBoolean());

        using var moved = await owner.PatchAsJsonAsync(endpoint + "/due-date", new
        {
            dueDate = "2026-11-19", expectedDueDate = "2026-11-17"
        });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        Assert.StartsWith("2026-11-19", (await GetTaskAsync(owner, id))
            .GetProperty("dueDate").GetString());

        using var stale = await owner.PatchAsJsonAsync(endpoint + "/due-date", new
        {
            dueDate = "2026-11-20", expectedDueDate = "2026-11-17"
        });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        using var otherMove = await otherUser.PatchAsJsonAsync(endpoint + "/due-date", new
        {
            dueDate = "2026-11-20", expectedDueDate = "2026-11-19"
        });
        Assert.Equal(HttpStatusCode.NotFound, otherMove.StatusCode);

        // Undo is the same guarded PATCH used by the frontend's Undo button.
        using var undone = await owner.PatchAsJsonAsync(endpoint + "/due-date", new
        {
            dueDate = "2026-11-17", expectedDueDate = "2026-11-19"
        });
        Assert.Equal(HttpStatusCode.OK, undone.StatusCode);
        Assert.StartsWith("2026-11-17", (await GetTaskAsync(owner, id))
            .GetProperty("dueDate").GetString());

        using var blockedDelete = await otherUser.DeleteAsync(endpoint);
        Assert.Equal(HttpStatusCode.NotFound, blockedDelete.StatusCode);
        using var deleted = await owner.DeleteAsync(endpoint);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        using var final = await owner.GetAsync("/api/tasks");
        Assert.DoesNotContain((await JsonAsync(final)).EnumerateArray(),
            item => item.GetProperty("id").GetInt32() == id);
    }
}
