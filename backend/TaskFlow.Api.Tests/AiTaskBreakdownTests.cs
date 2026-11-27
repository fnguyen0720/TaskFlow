using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AiTaskBreakdownTests
{
    private static async Task SignIn(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var register = await client.PostAsJsonAsync("/register", credentials);
        register.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        using var data = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", data.RootElement.GetProperty("accessToken").GetString());
    }

    private static object[] Items() => [
        new { title = "Outline project", priority = "High", category = "Work" },
        new { title = "Build prototype", priority = "Medium", category = "Work" }
    ];

    [Fact]
    public void ModelOutputIsUntrustedAndMustBeStructured()
    {
        Assert.Null(AiTaskBreakdown.Parse("not json"));
        Assert.Null(AiTaskBreakdown.Parse("{\"tasks\":[{\"title\":\"\"}]}"));
        Assert.Null(AiTaskBreakdown.Parse("{\"tasks\":[]}"));
        Assert.Null(AiTaskBreakdown.Parse("{\"tasks\":[{\"title\":\"Same\",\"priority\":\"High\",\"category\":\"Work\"},{\"title\":\"Same\",\"priority\":\"High\",\"category\":\"Work\"},{\"title\":\"Third\",\"priority\":\"Low\",\"category\":\"Study\"}]}"));
        var good = AiTaskBreakdown.Parse("{\"tasks\":[{\"title\":\"Outline\",\"priority\":\"High\",\"category\":\"Work\"},{\"title\":\"Build\",\"priority\":\"Medium\",\"category\":\"Work\"},{\"title\":\"Review\",\"priority\":\"Low\",\"category\":\"Study\"}]}");
        Assert.Equal(3, good!.Count);
        Assert.False(AiTaskBreakdown.ValidGoal("short"));
        Assert.True(AiTaskBreakdown.ValidGoal("Create a polished task management portfolio"));
    }

    [Fact]
    public async Task GenerateIsAuthenticatedConsentGatedAndDisabledByDefault()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        using (var anonymous = await client.PostAsJsonAsync("/api/ai/plans/generate",
            new { goal = "Create an impressive portfolio website", consent = true }))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        await SignIn(client, "ai-plan-" + Guid.NewGuid().ToString("N") + "@example.test");
        using var capabilities = await client.GetAsync("/api/ai/plans/capabilities");
        capabilities.EnsureSuccessStatusCode();
        var result = await capabilities.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(result.GetProperty("available").GetBoolean());
        using (var missingConsent = await client.PostAsJsonAsync("/api/ai/plans/generate",
            new { goal = "Create an impressive portfolio website", consent = false }))
            Assert.Equal(HttpStatusCode.BadRequest, missingConsent.StatusCode);
        using (var invalidGoal = await client.PostAsJsonAsync("/api/ai/plans/generate",
            new { goal = "hi", consent = true }))
            Assert.Equal(HttpStatusCode.BadRequest, invalidGoal.StatusCode);
        using (var disabled = await client.PostAsJsonAsync("/api/ai/plans/generate",
            new { goal = "Create an impressive portfolio website", consent = true }))
            Assert.Equal(HttpStatusCode.ServiceUnavailable, disabled.StatusCode);
        using var tasks = await client.GetAsync("/api/tasks");
        tasks.EnsureSuccessStatusCode();
        Assert.Empty((await tasks.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
    }

    [Fact]
    public async Task ExplicitApprovalCreatesOnlySelectedTasksAtomicallyForCurrentOwner()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var owner = factory.CreateClient();
        using var other = factory.CreateClient();
        await SignIn(owner, "ai-plan-owner-" + Guid.NewGuid().ToString("N") + "@example.test");
        await SignIn(other, "ai-plan-other-" + Guid.NewGuid().ToString("N") + "@example.test");

        using var projectCreated = await owner.PostAsJsonAsync("/api/projects", new { name = "Portfolio" });
        projectCreated.EnsureSuccessStatusCode();
        var project = await projectCreated.Content.ReadFromJsonAsync<JsonElement>();
        var projectId = project.GetProperty("id").GetInt32();

        using (var unconfirmed = await owner.PostAsJsonAsync("/api/ai/plans/commit",
            new { confirm = false, projectId, tasks = Items() }))
            Assert.Equal(HttpStatusCode.BadRequest, unconfirmed.StatusCode);
        using (var crossAccount = await other.PostAsJsonAsync("/api/ai/plans/commit",
            new { confirm = true, projectId, tasks = Items() }))
            Assert.Equal(HttpStatusCode.NotFound, crossAccount.StatusCode);
        using (var invalidBatch = await owner.PostAsJsonAsync("/api/ai/plans/commit",
            new { confirm = true, projectId, tasks = new object[] {
                new { title = "Valid", priority = "Medium", category = "Work" },
                new { title = "", priority = "Medium", category = "Work" }
            } }))
            Assert.Equal(HttpStatusCode.BadRequest, invalidBatch.StatusCode);

        using var before = await owner.GetAsync("/api/tasks");
        Assert.Empty((await before.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());

        using var committed = await owner.PostAsJsonAsync("/api/ai/plans/commit",
            new { confirm = true, projectId, tasks = Items() });
        Assert.Equal(HttpStatusCode.OK, committed.StatusCode);
        var data = await committed.Content.ReadFromJsonAsync<JsonElement>();
        var created = data.GetProperty("tasks").EnumerateArray().ToArray();
        Assert.Equal(2, created.Length);
        Assert.All(created, t => {
            Assert.False(t.GetProperty("completed").GetBoolean());
            Assert.Equal(projectId, t.GetProperty("projectId").GetInt32());
            Assert.Equal(JsonValueKind.Null, t.GetProperty("dueDate").ValueKind);
        });

        using var otherList = await other.GetAsync("/api/tasks");
        Assert.Empty((await otherList.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TaskDbContext>();
        foreach (var task in created)
        {
            var id = task.GetProperty("id").GetInt32();
            Assert.Equal(1, await db.TaskVersions.CountAsync(v => v.TaskId == id));
            Assert.Equal(1, await db.TaskActivities.CountAsync(a => a.TaskId == id));
        }
    }
}
