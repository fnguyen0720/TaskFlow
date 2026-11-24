using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public class ProgressionTests
{
    private static async Task Authenticate(HttpClient client)
    {
        var credentials = new { email = $"progress-{Guid.NewGuid():N}@example.test",
            password = "TestPassword123!" };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        using var data = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", data.RootElement.GetProperty("accessToken").GetString());
    }

    [Fact]
    public async Task ProgressionIsPrivateReadOnlyAndNeverRewardsRepeatCompletions()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();
        using (var unauthorized = await alice.GetAsync("/api/analytics/progression"))
            Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        await Authenticate(alice);
        await Authenticate(bob);
        using var create = await alice.PostAsJsonAsync("/api/tasks", new {
            title = "First real task", priority = "Medium"
        });
        create.EnsureSuccessStatusCode();
        var task = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id").GetInt32();

        using (var complete = await alice.PutAsync($"/api/tasks/{task}", null))
            Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        using (var reopen = await alice.PutAsync($"/api/tasks/{task}", null))
            Assert.Equal(HttpStatusCode.OK, reopen.StatusCode);
        using (var completeAgain = await alice.PutAsync($"/api/tasks/{task}", null))
            Assert.Equal(HttpStatusCode.OK, completeAgain.StatusCode);

        using var response = await alice.GetAsync("/api/analytics/progression");
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var progress = json.RootElement;
        Assert.Equal("first-recorded-completion", progress.GetProperty("basis").GetString());
        Assert.Equal(1, progress.GetProperty("level").GetInt32());
        Assert.Equal(25, progress.GetProperty("xp").GetInt64());
        Assert.Equal(1, progress.GetProperty("uniqueCompletedTasks").GetInt32());
        Assert.Equal(1, progress.GetProperty("completedThisWeek").GetInt32());
        var achievements = progress.GetProperty("achievements").EnumerateArray().ToArray();
        Assert.True(achievements.Single(a => a.GetProperty("id").GetString() == "first-step")
            .GetProperty("unlocked").GetBoolean());
        Assert.False(achievements.Single(a => a.GetProperty("id").GetString() == "ten-tasks")
            .GetProperty("unlocked").GetBoolean());
        Assert.Equal(1, progress.GetProperty("challenge").GetProperty("progress").GetInt32());

        using var other = await bob.GetAsync("/api/analytics/progression");
        other.EnsureSuccessStatusCode();
        using var otherJson = JsonDocument.Parse(await other.Content.ReadAsStringAsync());
        Assert.Equal(0, otherJson.RootElement.GetProperty("xp").GetInt64());
        Assert.Equal(0, otherJson.RootElement.GetProperty("uniqueCompletedTasks").GetInt32());

        // Progress reads are not mutations and do not reopen completed tasks.
        using var list = await alice.GetAsync("/api/tasks");
        list.EnsureSuccessStatusCode();
        Assert.True((await list.Content.ReadFromJsonAsync<JsonElement>())[0]
            .GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task FreshAccountsHaveZeroXpWithoutBackfill()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        await Authenticate(client);
        using var response = await client.GetAsync("/api/analytics/progression");
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, json.RootElement.GetProperty("xp").GetInt64());
        Assert.Equal(1, json.RootElement.GetProperty("level").GetInt32());
        Assert.Equal(100, json.RootElement.GetProperty("nextLevelXp").GetInt64());
        Assert.Equal(0, json.RootElement.GetProperty("completedThisWeek").GetInt32());
    }
}
