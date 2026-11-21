using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TaskFlow.Api.Tests;

public class TaskActivityTests
{
    private static async Task<string> Login(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();
        using var auth = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        auth.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await auth.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("accessToken").GetString()!;
    }

    private static async Task<JsonElement> Create(HttpClient client)
    {
        using var result = await client.PostAsJsonAsync("/api/tasks",
            new { title = "Tracked", priority = "Medium", category = "Work", dueDate = "2026-11-19" });
        result.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await result.Content.ReadAsStringAsync());
        return json.RootElement.Clone();
    }

    [Fact]
    public async Task EventsArePrivateSortedAndCreatedOnlyForSuccessfulMutations()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var a = factory.CreateClient();
        using var b = factory.CreateClient();
        a.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", await Login(a, $"activity-a-{Guid.NewGuid():N}@example.test"));
        b.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", await Login(b, $"activity-b-{Guid.NewGuid():N}@example.test"));
        var task = await Create(a);
        var id = task.GetProperty("id").GetInt32();
        var originalVersion = task.GetProperty("version").GetString()!;
        using (var forbidden = await b.GetAsync($"/api/tasks/{id}/activity"))
            Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);

        using (var edit = new HttpRequestMessage(HttpMethod.Put, $"/api/tasks/{id}/title"))
        {
            edit.Headers.TryAddWithoutValidation("If-Match", "\"" + originalVersion + "\"");
            edit.Content = JsonContent.Create(new
            {
                title = "Renamed", priority = "High", category = "Work",
                dueDate = "2026-11-20", recurrenceRule = "None", reminderDaysBefore = (int?)null
            });
            using var response = await a.SendAsync(edit);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        using (var conflict = new HttpRequestMessage(HttpMethod.Put, $"/api/tasks/{id}/title"))
        {
            conflict.Headers.TryAddWithoutValidation("If-Match", "\"" + originalVersion + "\"");
            conflict.Content = JsonContent.Create(new {
                title = "Stale", priority = "Low", category = "Work",
                dueDate = "2026-11-20", recurrenceRule = "None", reminderDaysBefore = (int?)null
            });
            using var response = await a.SendAsync(conflict);
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        }

        using var history = await a.GetAsync($"/api/tasks/{id}/activity");
        history.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await history.Content.ReadAsStringAsync());
        var events = json.RootElement.EnumerateArray().ToArray();
        Assert.Equal(3, events.Length);
        Assert.Equal("rescheduled", events[0].GetProperty("kind").GetString());
        Assert.Equal("edited", events[1].GetProperty("kind").GetString());
        Assert.Equal("created", events[2].GetProperty("kind").GetString());
        Assert.All(events, e => {
            Assert.False(e.TryGetProperty("notes", out _));
            Assert.False(e.TryGetProperty("title", out _));
            Assert.True(e.TryGetProperty("occurredAt", out _));
        });

        using var privateOther = await b.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.OK, privateOther.StatusCode);
        using var otherEvents = await b.GetAsync($"/api/tasks/{id}/activity");
        Assert.Equal(HttpStatusCode.NotFound, otherEvents.StatusCode);
    }

    [Fact]
    public async Task FailedMutationDoesNotAddActivityAndInitialTasksNeedNoBackfill()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", await Login(client, $"activity-no-write-{Guid.NewGuid():N}@example.test"));
        var created = await Create(client);
        var id = created.GetProperty("id").GetInt32();
        using var invalid = await client.PutAsJsonAsync($"/api/tasks/{id}/details",
            new { notes = new string('x', 4001), updateDueDate = false, checklist = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var response = await client.GetAsync($"/api/tasks/{id}/activity");
        var items = (await response.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Equal("created", Assert.Single(items).GetProperty("kind").GetString());
    }

    [Fact]
    public async Task UnauthenticatedActivityRequiresLogin()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/tasks/1/activity");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
