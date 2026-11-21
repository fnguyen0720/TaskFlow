using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace TaskFlow.Api.Tests;

public class TaskPaginationTests
{
    private sealed record LoginToken(string AccessToken);

    private static async Task<string> RegisterAndLoginAsync(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var register = await client.PostAsJsonAsync("/register", credentials);
        register.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        var tokens = await login.Content.ReadFromJsonAsync<LoginToken>();
        Assert.NotNull(tokens);
        return tokens.AccessToken;
    }

    [Fact]
    public async Task PagesAreBoundedStableAccountScopedAndLegacyRemainsAvailable()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var clientA = factory.CreateClient();
        using var clientB = factory.CreateClient();
        var emailA = $"page-a-{Guid.NewGuid():N}@example.test";
        var emailB = $"page-b-{Guid.NewGuid():N}@example.test";
        var tokenA = await RegisterAndLoginAsync(clientA, emailA);
        var tokenB = await RegisterAndLoginAsync(clientB, emailB);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TaskDbContext>();
            var ownerA = await db.Users.SingleAsync(u => u.Email == emailA);
            var ownerB = await db.Users.SingleAsync(u => u.Email == emailB);
            db.Tasks.AddRange(Enumerable.Range(1, 205).Select(i => new TaskItem
            {
                UserId = ownerA.Id,
                Title = $"Task {i:D3}",
                Priority = i % 3 == 0 ? "High" : i % 3 == 1 ? "Medium" : "Low",
                Completed = i % 5 == 0,
                DueDate = i % 4 == 0 ? null : new DateTime(2026, 11, 22, 0, 0, 0, DateTimeKind.Utc).AddDays(i % 7)
            }));
            db.Tasks.Add(new TaskItem { UserId = ownerB.Id, Title = "Other account private task" });
            await db.SaveChangesAsync();
        }

        clientA.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenA);
        var legacy = await clientA.GetFromJsonAsync<List<TaskItem>>("/api/tasks");
        Assert.NotNull(legacy);
        Assert.Equal(205, legacy.Count);
        var collected = new List<TaskItem>();
        foreach (var offset in new[] { 0, 100, 200 })
        {
            var page = await clientA.GetFromJsonAsync<List<TaskItem>>($"/api/tasks?offset={offset}&limit=100");
            Assert.NotNull(page);
            Assert.Equal(offset == 200 ? 5 : 100, page.Count);
            collected.AddRange(page);
        }
        Assert.Equal(205, collected.Count);
        Assert.Equal(205, collected.Select(t => t.Id).Distinct().Count());
        Assert.Equal(legacy.Select(t => t.Id), collected.Select(t => t.Id));
        Assert.DoesNotContain(collected, t => t.Title == "Other account private task");

        clientB.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokenB);
        var otherTasks = await clientB.GetFromJsonAsync<List<TaskItem>>("/api/tasks?offset=0&limit=100");
        Assert.NotNull(otherTasks);
        Assert.Equal("Other account private task", Assert.Single(otherTasks).Title);
        var beyond = await clientA.GetFromJsonAsync<List<TaskItem>>("/api/tasks?offset=205&limit=100");
        Assert.Empty(beyond!);
    }

    [Theory]
    [InlineData("/api/tasks?offset=-1&limit=100")]
    [InlineData("/api/tasks?offset=0&limit=0")]
    [InlineData("/api/tasks?offset=0&limit=101")]
    [InlineData("/api/tasks?offset=0")]
    [InlineData("/api/tasks?limit=100")]
    public async Task InvalidPaginationReturnsBadRequest(string url)
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var token = await RegisterAndLoginAsync(client, $"bad-page-{Guid.NewGuid():N}@example.test");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var result = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
    }

    [Fact]
    public async Task PaginatedEndpointRequiresAuthorization()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        using var result = await client.GetAsync("/api/tasks?offset=0&limit=100");
        Assert.Equal(HttpStatusCode.Unauthorized, result.StatusCode);
    }
}
