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
            new { title = "Tracked", priority = "Medium", category = "Work" });
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
    public async Task CompletionAnalyticsAreAuthenticatedTenantIsolatedAndReadOnly()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();
        using (var anonymous = await alice.GetAsync("/api/analytics/completions"))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        alice.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", await Login(alice, $"analytics-alice-{Guid.NewGuid():N}@example.test"));
        bob.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", await Login(bob, $"analytics-bob-{Guid.NewGuid():N}@example.test"));
        var task = await Create(alice);
        var id = task.GetProperty("id").GetInt32();
        using (var complete = await alice.PutAsync($"/api/tasks/{id}", null))
            Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        using (var reopen = await alice.PutAsync($"/api/tasks/{id}", null))
            Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);
        using (var completeAgain = await alice.PutAsync($"/api/tasks/{id}", null))
            Assert.Equal(HttpStatusCode.OK, completeAgain.StatusCode);

        using var result = await alice.GetAsync("/api/analytics/completions");
        result.EnsureSuccessStatusCode();
        using var data = JsonDocument.Parse(await result.Content.ReadAsStringAsync());
        var root = data.RootElement;
        Assert.Equal("UTC", root.GetProperty("timeZone").GetString());
        Assert.Equal(30, root.GetProperty("windowDays").GetInt32());
        var days = root.GetProperty("days").EnumerateArray().ToArray();
        Assert.Equal(30, days.Length);
        Assert.All(days, day => {
            Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", day.GetProperty("date").GetString()!);
            Assert.False(day.TryGetProperty("taskId", out _));
            Assert.False(day.TryGetProperty("title", out _));
        });
        Assert.Equal(2, root.GetProperty("totalCompletions").GetInt32());
        Assert.Equal(1, root.GetProperty("totalReopenings").GetInt32());
        Assert.Equal(2, days.Sum(day => day.GetProperty("completed").GetInt32()));
        Assert.Equal(1, days.Sum(day => day.GetProperty("reopened").GetInt32()));

        using var other = await bob.GetAsync("/api/analytics/completions");
        other.EnsureSuccessStatusCode();
        using var otherData = JsonDocument.Parse(await other.Content.ReadAsStringAsync());
        Assert.Equal(0, otherData.RootElement.GetProperty("totalCompletions").GetInt32());
        Assert.Equal(0, otherData.RootElement.GetProperty("totalReopenings").GetInt32());

        // Analytics reads must not alter the original task or audit metadata.
        using var taskResponse = await alice.GetAsync("/api/tasks");
        taskResponse.EnsureSuccessStatusCode();
        var tasks = (await taskResponse.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.True(Assert.Single(tasks).GetProperty("completed").GetBoolean());
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

    [Fact]
    public async Task CompletionReopeningAndDateChangeCreateOrderedActivity()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", await Login(client, $"activity-status-{Guid.NewGuid():N}@example.test"));
        var created = await Create(client);
        var id = created.GetProperty("id").GetInt32();

        using (var completed = await client.PutAsync($"/api/tasks/{id}", null))
            Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        using (var reopened = await client.PutAsync($"/api/tasks/{id}", null))
            Assert.Equal(HttpStatusCode.OK, reopened.StatusCode);
        using (var moved = await client.PutAsJsonAsync($"/api/tasks/{id}/due-date",
            new { dueDate = "2026-11-23" }))
            Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        using var response = await client.GetAsync($"/api/tasks/{id}/activity");
        response.EnsureSuccessStatusCode();
        var items = (await response.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Equal(new[] { "rescheduled", "reopened", "completed", "created" },
            items.Select(item => item.GetProperty("kind").GetString()).ToArray());
    }

}
