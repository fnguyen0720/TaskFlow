using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TaskFlow.Api.Tests;

public class TaskDependencyTests
{
    private static async Task Login(HttpClient client)
    {
        var credentials = new { email = $"dependency-{Guid.NewGuid():N}@example.test", password = "TestPassword123!" };
        (await client.PostAsJsonAsync("/register", credentials)).EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        var result = await login.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            result.GetProperty("accessToken").GetString());
    }

    private static async Task<int> NewTask(HttpClient client, string title)
    {
        using var response = await client.PostAsJsonAsync("/api/tasks",
            new { title, priority = "Medium" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
    }

    [Fact]
    public async Task DependenciesAreOwnerIsolatedAndBlockCompletionUntilPrerequisiteIsDone()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        await Login(owner);
        await Login(other);
        var first = await NewTask(owner, "Prerequisite");
        var second = await NewTask(owner, "Dependent");
        var outsider = await NewTask(other, "Other user");

        using var crossAccount = await owner.PutAsJsonAsync($"/api/tasks/{second}/dependencies",
            new { dependsOnIds = new[] { outsider }, expectedDependsOnIds = Array.Empty<int>() });
        Assert.Equal(HttpStatusCode.NotFound, crossAccount.StatusCode);
        using var invisible = await other.GetAsync($"/api/tasks/{second}/dependencies");
        Assert.Equal(HttpStatusCode.NotFound, invisible.StatusCode);

        using var saved = await owner.PutAsJsonAsync($"/api/tasks/{second}/dependencies",
            new { dependsOnIds = new[] { first }, expectedDependsOnIds = Array.Empty<int>() });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        using var blocked = await owner.PutAsync($"/api/tasks/{second}", null);
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        using var completePrerequisite = await owner.PutAsync($"/api/tasks/{first}", null);
        Assert.Equal(HttpStatusCode.OK, completePrerequisite.StatusCode);
        using var finish = await owner.PutAsync($"/api/tasks/{second}", null);
        Assert.Equal(HttpStatusCode.OK, finish.StatusCode);
    }

    [Fact]
    public async Task CyclesStaleWritesAndSelfDependenciesAreRejected()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        await Login(client);
        var a = await NewTask(client, "A");
        var b = await NewTask(client, "B");
        var c = await NewTask(client, "C");
        async Task<HttpResponseMessage> Save(int id, int[] next, int[] prior) =>
            await client.PutAsJsonAsync($"/api/tasks/{id}/dependencies",
                new { dependsOnIds = next, expectedDependsOnIds = prior });

        using var self = await Save(a, [a], []);
        Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode);
        using var first = await Save(a, [b], []);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var second = await Save(b, [c], []);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        using var cycle = await Save(c, [a], []);
        Assert.Equal(HttpStatusCode.BadRequest, cycle.StatusCode);
        using var stale = await Save(a, [], []);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using var current = await client.GetAsync($"/api/tasks/{a}/dependencies");
        current.EnsureSuccessStatusCode();
        var edges = await current.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(b, edges[0].GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task BottleneckCoachIsReadOnlyPrivateAndPrioritizesSharedBlockers()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var outsider = factory.CreateClient();
        using (var anonymous = await owner.GetAsync("/api/analytics/bottlenecks"))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        await Login(owner);
        await Login(outsider);

        var prerequisite = await NewTask(owner, "Shared prerequisite");
        var dueTomorrow = DateTime.UtcNow.Date.AddDays(1).ToString("yyyy-MM-dd");
        using var dated = await owner.PostAsJsonAsync("/api/tasks",
            new { title = "Dependent A", priority = "High", dueDate = dueTomorrow });
        Assert.Equal(HttpStatusCode.Created, dated.StatusCode);
        var first = (await dated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var second = await NewTask(owner, "Dependent B");
        _ = await NewTask(outsider, "Other account private work");
        using (var linked = await owner.PutAsJsonAsync($"/api/tasks/{first}/dependencies",
            new { dependsOnIds = new[] { prerequisite }, expectedDependsOnIds = Array.Empty<int>() }))
            Assert.Equal(HttpStatusCode.OK, linked.StatusCode);
        using (var linked = await owner.PutAsJsonAsync($"/api/tasks/{second}/dependencies",
            new { dependsOnIds = new[] { prerequisite }, expectedDependsOnIds = Array.Empty<int>() }))
            Assert.Equal(HttpStatusCode.OK, linked.StatusCode);

        using var response = await owner.GetAsync("/api/analytics/bottlenecks");
        response.EnsureSuccessStatusCode();
        using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = result.RootElement;
        Assert.Equal("rules", root.GetProperty("analysis").GetString());
        Assert.Equal(3, root.GetProperty("metrics").GetProperty("activeTasks").GetInt32());
        Assert.Equal(2, root.GetProperty("metrics").GetProperty("blockedTasks").GetInt32());
        var advice = root.GetProperty("recommendations").EnumerateArray().ToArray();
        Assert.Contains(advice, x => x.GetProperty("id").GetString() == "blocked-deadline" &&
            x.GetProperty("taskId").GetInt32() == first);
        Assert.Contains(advice, x => x.GetProperty("id").GetString() == "shared-prerequisite" &&
            x.GetProperty("taskId").GetInt32() == prerequisite);
        Assert.DoesNotContain("Other account private work", root.GetRawText());

        using var otherResponse = await outsider.GetAsync("/api/analytics/bottlenecks");
        otherResponse.EnsureSuccessStatusCode();
        using var other = JsonDocument.Parse(await otherResponse.Content.ReadAsStringAsync());
        Assert.Equal(1, other.RootElement.GetProperty("metrics").GetProperty("activeTasks").GetInt32());
        Assert.Equal(0, other.RootElement.GetProperty("metrics").GetProperty("blockedTasks").GetInt32());
        Assert.DoesNotContain(first.ToString(), other.RootElement.GetProperty("recommendations").GetRawText());

        using var stillBlocked = await owner.PutAsync($"/api/tasks/{first}", null);
        Assert.Equal(HttpStatusCode.Conflict, stillBlocked.StatusCode);
        using var taskList = await owner.GetAsync("/api/tasks");
        taskList.EnsureSuccessStatusCode();
        Assert.Equal(3, (await taskList.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());
    }

    [Fact]
    public async Task BottleneckCoachCountsOnlyCallerRecordedCompletionEvents()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        await Login(owner);
        await Login(other);
        var taskId = await NewTask(owner, "Completed item");
        using (var completed = await owner.PutAsync($"/api/tasks/{taskId}", null))
            Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        using var ownerResponse = await owner.GetAsync("/api/analytics/bottlenecks");
        ownerResponse.EnsureSuccessStatusCode();
        using var ownerJson = JsonDocument.Parse(await ownerResponse.Content.ReadAsStringAsync());
        Assert.Equal(1, ownerJson.RootElement.GetProperty("metrics").GetProperty("completionsLast7Days").GetInt32());
        using var otherResponse = await other.GetAsync("/api/analytics/bottlenecks");
        otherResponse.EnsureSuccessStatusCode();
        using var otherJson = JsonDocument.Parse(await otherResponse.Content.ReadAsStringAsync());
        Assert.Equal(0, otherJson.RootElement.GetProperty("metrics").GetProperty("completionsLast7Days").GetInt32());
    }

    [Fact]
    public async Task NestedSubtasksKeepMetadataAndRejectBadParents()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        await Login(client);
        var id = await NewTask(client, "Nested");
        var root = Guid.NewGuid().ToString();
        var child = Guid.NewGuid().ToString();
        using var accepted = await client.PutAsJsonAsync($"/api/tasks/{id}/details", new {
            notes = "",
            checklist = new object[] {
                new { text = "Parent", completed = false, id = root, priority = "High" },
                new { text = "Child", completed = false, id = child, parentId = root,
                    priority = "Low", dueDate = "2026-12-01" }
            }
        });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var task = await accepted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(child, task.GetProperty("checklist")[1].GetProperty("id").GetString());
        Assert.Equal(root, task.GetProperty("checklist")[1].GetProperty("parentId").GetString());

        using var rejected = await client.PutAsJsonAsync($"/api/tasks/{id}/details", new {
            checklist = new[] { new { text = "Invalid", completed = false, id = child, parentId = child } }
        });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }
}
