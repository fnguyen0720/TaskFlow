using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TaskFlow.Api.Tests;

public class ProjectGroupingTests
{
    private static async Task Login(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        var response = await login.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", response.GetProperty("accessToken").GetString());
    }

    private static async Task<JsonElement> CreateTask(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync("/api/tasks",
            new { title = "Ungrouped task", priority = "Medium", category = "Work" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task ProjectCreationAndGuardedAssignmentAreOwnerScoped()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var a = factory.CreateClient();
        using var b = factory.CreateClient();
        await Login(a, $"projects-a-{Guid.NewGuid():N}@example.test");
        await Login(b, $"projects-b-{Guid.NewGuid():N}@example.test");
        var task = await CreateTask(a);
        int id = task.GetProperty("id").GetInt32();
        var firstVersion = task.GetProperty("version").GetString()!;
        Assert.Equal(JsonValueKind.Null, task.GetProperty("projectId").ValueKind);
        using var created = await a.PostAsJsonAsync("/api/projects", new { name = "Career development" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var project = await created.Content.ReadFromJsonAsync<JsonElement>();
        int projectId = project.GetProperty("id").GetInt32();

        using var invisible = await b.GetAsync("/api/projects");
        invisible.EnsureSuccessStatusCode();
        Assert.Empty((await invisible.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
        using var crossAccount = await b.PutAsJsonAsync($"/api/tasks/{id}/project", new { projectId });
        Assert.Equal(HttpStatusCode.NotFound, crossAccount.StatusCode);

        using var denied = await SendMove(a, id, firstVersion, projectId + 999999);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        using var changed = await SendMove(a, id, firstVersion, projectId);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var updated = await changed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(projectId, updated.GetProperty("projectId").GetInt32());
        var latestVersion = updated.GetProperty("version").GetString()!;
        Assert.NotEqual(firstVersion, latestVersion);

        using var stale = await SendMove(a, id, firstVersion, null);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using var history = await a.GetAsync($"/api/tasks/{id}/versions");
        history.EnsureSuccessStatusCode();
        var versions = (await history.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Equal(2, versions.Length);
        Assert.Equal(projectId, versions[0].GetProperty("snapshot").GetProperty("projectId").GetInt32());
        Assert.Equal(JsonValueKind.Null, versions[1].GetProperty("snapshot").GetProperty("projectId").ValueKind);

        using var ungroup = await SendMove(a, id, latestVersion, null);
        Assert.Equal(HttpStatusCode.OK, ungroup.StatusCode);
        var ungrouped = await ungroup.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, ungrouped.GetProperty("projectId").ValueKind);

        using var list = await a.GetAsync("/api/tasks");
        list.EnsureSuccessStatusCode();
        var tasks = (await list.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Single(tasks);
    }

    [Fact]
    public async Task ProjectCreationValidatesNamesAndCannotReadOtherAccounts()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var a = factory.CreateClient();
        using var anon = factory.CreateClient();
        await Login(a, $"project-valid-{Guid.NewGuid():N}@example.test");

        using var unauthorized = await anon.GetAsync("/api/projects");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        using var empty = await a.PostAsJsonAsync("/api/projects", new { name = "  " });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        using var tooLong = await a.PostAsJsonAsync("/api/projects", new { name = new string('x', 71) });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        using var created = await a.PostAsJsonAsync("/api/projects", new { name = "Personal goals" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var duplicate = await a.PostAsJsonAsync("/api/projects", new { name = "Personal goals" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task LegacyTasksRemainUngroupedWithoutMigrationBackfill()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        await Login(client, $"project-legacy-{Guid.NewGuid():N}@example.test");
        var task = await CreateTask(client);
        Assert.Equal(JsonValueKind.Null, task.GetProperty("projectId").ValueKind);
        using var list = await client.GetAsync("/api/tasks");
        list.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null,
            (await list.Content.ReadFromJsonAsync<JsonElement>())[0].GetProperty("projectId").ValueKind);
    }

    private static async Task<HttpResponseMessage> SendMove(HttpClient client, int id, string version, int? projectId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/tasks/{id}/project");
        request.Headers.TryAddWithoutValidation("If-Match", "\"" + version + "\"");
        request.Content = JsonContent.Create(new { projectId });
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task NewTaskCanJoinOwnedProjectAtCreationWithoutASecondMutation()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var outsider = factory.CreateClient();
        await Login(owner, $"project-create-owner-{Guid.NewGuid():N}@example.test");
        await Login(outsider, $"project-create-outsider-{Guid.NewGuid():N}@example.test");

        using var projectResponse = await owner.PostAsJsonAsync("/api/projects", new { name = "Career" });
        Assert.Equal(HttpStatusCode.Created, projectResponse.StatusCode);
        var project = await projectResponse.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = project.GetProperty("id").GetInt32();

        using var created = await owner.PostAsJsonAsync("/api/tasks",
            new { title = "Apply for jobs", priority = "High", projectId });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var saved = await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(projectId, saved.GetProperty("projectId").GetInt32());
        var taskId = saved.GetProperty("id").GetInt32();

        using var list = await owner.GetAsync("/api/tasks");
        list.EnsureSuccessStatusCode();
        var tasks = (await list.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Single(tasks);
        Assert.Equal(projectId, tasks[0].GetProperty("projectId").GetInt32());

        using var history = await owner.GetAsync($"/api/tasks/{taskId}/versions");
        history.EnsureSuccessStatusCode();
        var snapshots = (await history.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Single(snapshots);
        Assert.Equal(projectId, snapshots[0].GetProperty("snapshot").GetProperty("projectId").GetInt32());

        using var forbidden = await outsider.PostAsJsonAsync("/api/tasks",
            new { title = "Should not be created", priority = "Medium", projectId });
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
        using var outsiderTasks = await outsider.GetAsync("/api/tasks");
        outsiderTasks.EnsureSuccessStatusCode();
        Assert.Empty((await outsiderTasks.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray());

        using var ungrouped = await owner.PostAsJsonAsync("/api/tasks",
            new { title = "Ungrouped task", priority = "Medium" });
        Assert.Equal(HttpStatusCode.Created, ungrouped.StatusCode);
        var ungroupedJson = await ungrouped.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null, ungroupedJson.GetProperty("projectId").ValueKind);
    }

    [Fact]
    public async Task RenamingProjectPreservesTasksAndRejectsOtherAccounts()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        await Login(owner, $"rename-owner-{Guid.NewGuid():N}@example.test");
        await Login(other, $"rename-other-{Guid.NewGuid():N}@example.test");
        using var created = await owner.PostAsJsonAsync("/api/projects", new { name = "Career" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        using var task = await owner.PostAsJsonAsync("/api/tasks",
            new { title = "Prepare resume", priority = "Medium", projectId = id });
        Assert.Equal(HttpStatusCode.Created, task.StatusCode);
        var taskId = (await task.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        using var forbidden = await other.PutAsJsonAsync($"/api/projects/{id}", new { name = "Stolen" });
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
        using var anonymous = factory.CreateClient();
        using var noAuth = await anonymous.PutAsJsonAsync($"/api/projects/{id}", new { name = "Stolen" });
        Assert.Equal(HttpStatusCode.Unauthorized, noAuth.StatusCode);
        using var invalid = await owner.PutAsJsonAsync($"/api/projects/{id}", new { name = " " });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var missing = await owner.PutAsJsonAsync("/api/projects/999999", new { name = "Missing" });
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        using var second = await owner.PostAsJsonAsync("/api/projects", new { name = "Personal" });
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        using var duplicate = await owner.PutAsJsonAsync($"/api/projects/{id}", new { name = "Personal" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        using var renamed = await owner.PutAsJsonAsync($"/api/projects/{id}", new { name = "Career Development" });
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var updated = await renamed.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, updated.GetProperty("id").GetInt32());
        Assert.Equal("Career Development", updated.GetProperty("name").GetString());

        using var projects = await owner.GetAsync("/api/projects");
        projects.EnsureSuccessStatusCode();
        var list = (await projects.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Contains(list, p => p.GetProperty("id").GetInt32() == id &&
            p.GetProperty("name").GetString() == "Career Development");
        using var tasks = await owner.GetAsync("/api/tasks");
        tasks.EnsureSuccessStatusCode();
        var saved = (await tasks.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray().ToArray();
        Assert.Single(saved);
        Assert.Equal(taskId, saved[0].GetProperty("id").GetInt32());
        Assert.Equal(id, saved[0].GetProperty("projectId").GetInt32());
    }
}
