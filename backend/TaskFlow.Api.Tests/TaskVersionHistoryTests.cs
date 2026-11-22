using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TaskFlow.Api.Tests;

public class TaskVersionHistoryTests
{
    private static async Task Login(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();
        using var response = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", json.RootElement.GetProperty("accessToken").GetString());
    }

    private static async Task<JsonElement> Create(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync("/api/tasks",
            new { title = "Original task", priority = "Medium", category = "Work" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).Clone();
    }

    private static async Task<HttpResponseMessage> Edit(HttpClient client, int id, string version, string title)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/tasks/{id}/title");
        request.Headers.TryAddWithoutValidation("If-Match", "\"" + version + "\"");
        request.Content = JsonContent.Create(new {
            title, priority = "High", category = "Study",
            recurrenceRule = "None", reminderDaysBefore = (int?)null,
            dueDate = (string?)null
        });
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> Restore(HttpClient client, int id, long selected, string? version)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/tasks/{id}/restore");
        if (version != null) request.Headers.TryAddWithoutValidation("If-Match", "\"" + version + "\"");
        request.Content = JsonContent.Create(new { versionId = selected });
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task PreviousAndCurrentVersionsArePrivateAndRestoreIsConflictSafe()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        await Login(owner, $"version-owner-{Guid.NewGuid():N}@example.test");
        await Login(other, $"version-other-{Guid.NewGuid():N}@example.test");

        var created = await Create(owner);
        var id = created.GetProperty("id").GetInt32();
        var firstFingerprint = created.GetProperty("version").GetString()!;

        using var notYours = await other.GetAsync($"/api/tasks/{id}/versions");
        Assert.Equal(HttpStatusCode.NotFound, notYours.StatusCode);

        using var change = await Edit(owner, id, firstFingerprint, "Changed task");
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);
        var latest = await change.Content.ReadFromJsonAsync<JsonElement>();
        var latestFingerprint = latest.GetProperty("version").GetString()!;
        Assert.NotEqual(firstFingerprint, latestFingerprint);

        using var list = await owner.GetAsync($"/api/tasks/{id}/versions");
        list.EnsureSuccessStatusCode();
        var history = (await list.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Equal(2, history.Length);
        Assert.Equal("Changed task", history[0].GetProperty("snapshot").GetProperty("title").GetString());
        Assert.Equal("Original task", history[1].GetProperty("snapshot").GetProperty("title").GetString());
        var originalVersionId = history[1].GetProperty("id").GetInt64();

        using var invalid = await Restore(owner, id, originalVersionId, null);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var unauthorized = await Restore(other, id, originalVersionId, latestFingerprint);
        Assert.Equal(HttpStatusCode.NotFound, unauthorized.StatusCode);
        using var oldVersion = await Restore(owner, id, originalVersionId, firstFingerprint);
        Assert.Equal(HttpStatusCode.Conflict, oldVersion.StatusCode);

        using var restored = await Restore(owner, id, originalVersionId, latestFingerprint);
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        var restoredJson = await restored.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Original task", restoredJson.GetProperty("title").GetString());
        Assert.Equal("Medium", restoredJson.GetProperty("priority").GetString());

        using var verify = await owner.GetAsync($"/api/tasks/{id}/versions");
        var newHistory = (await verify.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Equal(3, newHistory.Length);
        Assert.Equal("restored", newHistory[0].GetProperty("kind").GetString());
        Assert.Equal("Changed task", newHistory[1].GetProperty("snapshot").GetProperty("title").GetString());
    }

    [Fact]
    public async Task ExistingTaskGetsBaselineOnFirstSuccessfulWriteNotOnHistoryRead()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var email = $"version-legacy-{Guid.NewGuid():N}@example.test";
        await Login(client, email);
        int id;
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TaskDbContext>();
            var account = await db.Users.SingleAsync(user => user.Email == email);
            var task = new TaskItem { Title = "Before feature", Priority = "Low", UserId = account.Id };
            db.Tasks.Add(task);
            await db.SaveChangesAsync();
            id = task.Id;
        }
        using var initial = await client.GetAsync($"/api/tasks/{id}/versions");
        Assert.Empty((await initial.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray());

        using var edit = await client.PutAsJsonAsync($"/api/tasks/{id}/details", new {
            notes = "Private note",
            checklist = new[] { new { text = "Review", completed = false } },
            updateDueDate = false
        });
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        using var after = await client.GetAsync($"/api/tasks/{id}/versions");
        var snapshots = (await after.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Equal(2, snapshots.Length);
        Assert.Equal("baseline", snapshots[1].GetProperty("kind").GetString());
        Assert.Equal("", snapshots[1].GetProperty("snapshot").GetProperty("notes").GetString());
        Assert.Equal("Private note", snapshots[0].GetProperty("snapshot").GetProperty("notes").GetString());
    }

    [Fact]
    public async Task FailedEditOrConflictedRestoreDoesNotAppendSnapshots()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        await Login(client, $"version-rejected-{Guid.NewGuid():N}@example.test");
        var task = await Create(client);
        var id = task.GetProperty("id").GetInt32();
        var fingerprint = task.GetProperty("version").GetString()!;
        using var invalid = await client.PutAsJsonAsync($"/api/tasks/{id}/details",
            new { notes = new string('x', 4001), checklist = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var before = await client.GetAsync($"/api/tasks/{id}/versions");
        var versions = (await before.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Single(versions);
        using var edit = await Edit(client, id, fingerprint, "Newer title");
        Assert.Equal(HttpStatusCode.OK, edit.StatusCode);
        using var stale = await Restore(client, id, versions[0].GetProperty("id").GetInt64(), fingerprint);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using var after = await client.GetAsync($"/api/tasks/{id}/versions");
        Assert.Equal(2, (await after.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());
    }
}
