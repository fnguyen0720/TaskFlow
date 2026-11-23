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
