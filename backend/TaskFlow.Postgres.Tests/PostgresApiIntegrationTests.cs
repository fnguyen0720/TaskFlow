using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
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
