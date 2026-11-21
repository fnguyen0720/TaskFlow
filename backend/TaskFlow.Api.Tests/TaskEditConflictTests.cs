using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public class TaskEditConflictTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<string> Token(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var registered = await client.PostAsJsonAsync("/register", credentials);
        registered.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("accessToken").GetString()!;
    }

    private static async Task<JsonElement> Create(HttpClient client)
    {
        using var result = await client.PostAsJsonAsync("/api/tasks",
            new { title = "Initial title", priority = "Medium", category = "Work" });
        Assert.Equal(HttpStatusCode.Created, result.StatusCode);
        return JsonDocument.Parse(await result.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task<HttpResponseMessage> GuardedPut(
        HttpClient client, string route, object data, string version)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, route);
        request.Headers.TryAddWithoutValidation("If-Match", "\""+version+"\"");
        request.Content = JsonContent.Create(data);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task StaleInlineEditsAreRejectedWithoutOverwritingLatestTask()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var token = await Token(client, $"edit-conflict-{Guid.NewGuid():N}@example.test");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var created = await Create(client);
        var id = created.GetProperty("id").GetInt32();
        var stale = created.GetProperty("version").GetString()!;
        Assert.Matches("^[0-9a-f]{64}$", stale);

        var first = new { title = "Newer edit", priority = "High", category = "Work",
            recurrenceRule = "None", reminderDaysBefore = (int?)null, dueDate = (DateTime?)null };
        using var saved = await GuardedPut(client, $"/api/tasks/{id}/title", first, stale);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var latest = (await saved.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("version").GetString()!;
        Assert.NotEqual(stale, latest);

        using var staleSave = await GuardedPut(client, $"/api/tasks/{id}/title",
            new { title = "Overwrite attempt", priority = "Low", category = "Work",
                recurrenceRule = "None", reminderDaysBefore = (int?)null, dueDate = (DateTime?)null }, stale);
        Assert.Equal(HttpStatusCode.Conflict, staleSave.StatusCode);

        using var read = await client.GetAsync("/api/tasks");
        var list = (await read.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        var task = Assert.Single(list);
        Assert.Equal("Newer edit", task.GetProperty("title").GetString());
        Assert.Equal("High", task.GetProperty("priority").GetString());
        Assert.Equal(latest, task.GetProperty("version").GetString());
    }

    [Fact]
    public async Task StaleDetailEditsAndMismatchedAccountsCannotModifyTasks()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        var ownerToken = await Token(owner, $"details-owner-{Guid.NewGuid():N}@example.test");
        var otherToken = await Token(other, $"details-other-{Guid.NewGuid():N}@example.test");
        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ownerToken);
        other.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", otherToken);

        var created = await Create(owner);
        var id = created.GetProperty("id").GetInt32();
        var oldVersion = created.GetProperty("version").GetString()!;
        var first = new { notes = "Current notes", updateDueDate = false,
            dueDate = (string?)null, checklist = new[] { new { text = "First step", completed = false } } };
        using var saved = await GuardedPut(owner, $"/api/tasks/{id}/details", first, oldVersion);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var nextVersion = (await saved.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("version").GetString()!;
        using var conflict = await GuardedPut(owner, $"/api/tasks/{id}/details",
            new { notes = "Old draft should not win", updateDueDate = false,
                dueDate = (string?)null, checklist = Array.Empty<object>() }, oldVersion);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);

        using var denied = await GuardedPut(other, $"/api/tasks/{id}/details", first, nextVersion);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        using var verify = await owner.GetAsync("/api/tasks");
        var stored = Assert.Single((await verify.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray());
        Assert.Equal("Current notes", stored.GetProperty("notes").GetString());
        Assert.Equal(nextVersion, stored.GetProperty("version").GetString());
        Assert.Equal(1, stored.GetProperty("checklist").GetArrayLength());
    }

    [Fact]
    public async Task MalformedGuardIsRejectedAndLegacyClientsRemainCompatible()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var token = await Token(client, $"edit-legacy-{Guid.NewGuid():N}@example.test");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var created = await Create(client);
        var id = created.GetProperty("id").GetInt32();
        var body = new { title = "Valid title", priority = "Medium", category = "Work",
            recurrenceRule = "None", reminderDaysBefore = (int?)null, dueDate = (DateTime?)null };
        using var bad = await GuardedPut(client, $"/api/tasks/{id}/title", body, "not-a-version");
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        using var legacy = await client.PutAsJsonAsync($"/api/tasks/{id}/title", body);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
    }
}
