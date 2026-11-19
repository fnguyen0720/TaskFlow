using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace TaskFlow.Api.Tests;

public class BackendSecurityTests
{
    private static async Task<HttpClient> AuthorizedClientAsync(
        CustomWebApplicationFactory factory)
    {
        await factory.InitializeDatabaseAsync();
        var client = factory.CreateClient();
        var email = $"security-{Guid.NewGuid():N}@example.com";
        var credentials = new { email, password = "TestPassword123!" };

        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();

        using var login = await client.PostAsJsonAsync(
            "/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();

        var payload = await login.Content.ReadFromJsonAsync<LoginTokens>();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrWhiteSpace(payload.AccessToken));
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", payload.AccessToken);
        return client;
    }

    private sealed record LoginTokens(string AccessToken);

    private static async Task<HttpResponseMessage> SendPreflightAsync(
        HttpClient client, string origin)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Options, "/api/tasks");
        request.Headers.Add("Origin", origin);
        request.Headers.TryAddWithoutValidation(
            "Access-Control-Request-Method", "GET");
        request.Headers.TryAddWithoutValidation(
            "Access-Control-Request-Headers", "authorization");
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Cors_AllowsKnownProductionOrigin()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = factory.CreateClient();
        const string origin = "https://task-flow-pi-lake.vercel.app";

        using var response = await SendPreflightAsync(client, origin);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(
            origin,
            Assert.Single(response.Headers.GetValues(
                "Access-Control-Allow-Origin")));
    }

    [Theory]
    [InlineData("https://task-flow-attacker.vercel.app")]
    [InlineData("https://task-flow-pi-lake.vercel.app.attacker.test")]
    [InlineData("https://unlisted-preview.vercel.app")]
    [InlineData("http://task-flow-pi-lake.vercel.app")]
    public async Task Cors_RejectsUnlistedOrigins(string origin)
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = factory.CreateClient();

        using var response = await SendPreflightAsync(client, origin);

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Cors_AllowsExplicitlyConfiguredPreview()
    {
        await using var factory = new CustomWebApplicationFactory();
        const string origin = "https://trusted-preview.vercel.app";

        using var configured = factory.WithWebHostBuilder(builder =>
            builder.ConfigureAppConfiguration((_, config) =>
                config.AddInMemoryCollection(
                    new Dictionary<string, string?>
                    {
                        ["Cors:AllowedOrigins:1"] = origin
                    })));

        using var client = configured.CreateClient();
        using var response = await SendPreflightAsync(client, origin);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(
            origin,
            Assert.Single(response.Headers.GetValues(
                "Access-Control-Allow-Origin")));
    }

    [Fact]
    public async Task IdentityApi_ThrottlesRepeatedLoginAttempts()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();

        var credentials = new
        {
            email = "unknown-user@example.com",
            password = "IncorrectPassword123!"
        };

        for (var attempt = 0; attempt < 20; attempt++)
        {
            using var response = await client.PostAsJsonAsync(
                "/login?useCookies=false", credentials);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        }

        using var throttled = await client.PostAsJsonAsync(
            "/login?useCookies=false", credentials);

        Assert.Equal(HttpStatusCode.TooManyRequests, throttled.StatusCode);
        Assert.Equal("60", Assert.Single(
            throttled.Headers.GetValues("Retry-After")));
    }

    [Fact]
    public async Task IdentityRateLimit_TrustedEdgeClientsHaveSeparateBudgets()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var configured = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["RENDER_SERVICE_ID"] = "srv-test-only",
                    ["RENDER_SERVICE_TYPE"] = "web",
                    ["Security:TrustRenderPublicEdgeClientIp"] = "true"
                }));
        });

        using (var scope = configured.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TaskDbContext>();
            await db.Database.EnsureCreatedAsync();
        }
        using var clientA = configured.CreateClient();
        using var clientB = configured.CreateClient();
        clientA.DefaultRequestHeaders.Add("CF-Connecting-IP", "198.51.100.10");
        clientB.DefaultRequestHeaders.Add("CF-Connecting-IP", "198.51.100.11");

        var clientBCredentials = new
        {
            email = "partition-b@example.com",
            password = "TestPassword!123"
        };
        using var registrationB = await clientB.PostAsJsonAsync("/register", clientBCredentials);
        Assert.Equal(HttpStatusCode.OK, registrationB.StatusCode);

        var credentials = new
        {
            email = "invalid-account@example.com",
            password = "NotThePassword!123"
        };

        for (var i = 0; i < 20; i++)
        {
            using var attempt = await clientA.PostAsJsonAsync(
                "/login?useCookies=false", credentials);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, attempt.StatusCode);
        }

        // Spoofed X-Forwarded-For must not give A another partition.
        clientA.DefaultRequestHeaders.TryAddWithoutValidation(
            "X-Forwarded-For", "192.0.2.200");
        using var blockedA = await clientA.PostAsJsonAsync(
            "/login?useCookies=false", credentials);
        Assert.Equal(HttpStatusCode.TooManyRequests, blockedA.StatusCode);

        // B can sign in with its own account while A is still throttled.
        using var allowedB = await clientB.PostAsJsonAsync(
            "/login?useCookies=false", clientBCredentials);
        Assert.Equal(HttpStatusCode.OK, allowedB.StatusCode);

        using var stillBlockedA = await clientA.PostAsJsonAsync(
            "/login?useCookies=false", credentials);
        Assert.Equal(HttpStatusCode.TooManyRequests, stillBlockedA.StatusCode);
    }

    [Fact]
    public async Task IdentityRateLimit_WithoutRenderMarkerIgnoresClientIpHeaders()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var configured = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Security:TrustRenderPublicEdgeClientIp"] = "true",
                    ["RENDER_SERVICE_ID"] = ""
                }));
        });

        using (var scope = configured.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TaskDbContext>();
            await db.Database.EnsureCreatedAsync();
        }
        using var clientA = configured.CreateClient();
        using var clientB = configured.CreateClient();
        clientA.DefaultRequestHeaders.Add("CF-Connecting-IP", "198.51.100.10");
        clientB.DefaultRequestHeaders.Add("CF-Connecting-IP", "198.51.100.11");

        var credentials = new
        {
            email = "invalid-account@example.com",
            password = "NotThePassword!123"
        };

        for (var i = 0; i < 20; i++)
        {
            using var attempt = await clientA.PostAsJsonAsync(
                "/login?useCookies=false", credentials);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, attempt.StatusCode);
        }

        using var blockedB = await clientB.PostAsJsonAsync(
            "/login?useCookies=false", credentials);
        Assert.Equal(HttpStatusCode.TooManyRequests, blockedB.StatusCode);
    }

    [Theory]
    [InlineData("General")]
    [InlineData("Work")]
    [InlineData("Study")]
    [InlineData("Personal")]
    public async Task CreateTask_AllowsKnownCategories(string category)
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = await AuthorizedClientAsync(factory);
        using var response = await client.PostAsJsonAsync(
            "/api/tasks", new
            {
                title = "Category test",
                priority = "Medium",
                category
            });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var task = await response.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(task);
        Assert.Equal(category, task.Category);
    }

    [Theory]
    [InlineData("Other")]
    [InlineData("work")]
    [InlineData("")]
    [InlineData("Personal/../../../")]
    public async Task CreateTask_RejectsUnrecognizedCategory(string category)
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = await AuthorizedClientAsync(factory);
        using var response = await client.PostAsJsonAsync(
            "/api/tasks", new
            {
                title = "Invalid category test",
                priority = "Medium",
                category
            });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateTask_TrimsTitleAndIgnoresForgedEntityFields()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = await AuthorizedClientAsync(factory);
        using var response = await client.PostAsJsonAsync(
            "/api/tasks", new
            {
                id = 987654,
                title = "   Trimmed task   ",
                completed = true,
                priority = "High",
                category = "Work",
                userId = "forged-user-id"
            });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var task = await response.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(task);
        Assert.Equal("Trimmed task", task.Title);
        Assert.NotEqual(987654, task.Id);
        Assert.False(task.Completed);
        Assert.NotEqual("forged-user-id", task.UserId);
    }

    [Fact]
    public async Task EditTask_WithInvalidCategory_DoesNotChangeStoredTask()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = await AuthorizedClientAsync(factory);

        using var created = await client.PostAsJsonAsync(
            "/api/tasks", new
            {
                title = "Original title",
                priority = "Medium",
                category = "Work"
            });
        created.EnsureSuccessStatusCode();

        var original = await created.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(original);

        using var invalidEdit = await client.PutAsJsonAsync(
            $"/api/tasks/{original.Id}/title", new
            {
                title = "Changed title",
                priority = "High",
                category = "SomeOtherCategory"
            });

        Assert.Equal(HttpStatusCode.BadRequest, invalidEdit.StatusCode);

        var tasks = await client.GetFromJsonAsync<List<TaskItem>>("/api/tasks");
        Assert.NotNull(tasks);
        var actual = Assert.Single(tasks, task => task.Id == original.Id);
        Assert.Equal("Original title", actual.Title);
        Assert.Equal("Medium", actual.Priority);
        Assert.Equal("Work", actual.Category);
    }

    [Fact]
    public async Task EditTask_TrimsValidTitle()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = await AuthorizedClientAsync(factory);

        using var created = await client.PostAsJsonAsync(
            "/api/tasks", new
            {
                title = "Before",
                priority = "Low",
                category = "General"
            });
        created.EnsureSuccessStatusCode();
        var task = await created.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(task);

        using var edited = await client.PutAsJsonAsync(
            $"/api/tasks/{task.Id}/title", new
            {
                title = "  After  ",
                priority = "High",
                category = "Personal"
            });

        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        var updated = await edited.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(updated);
        Assert.Equal("After", updated.Title);
        Assert.Equal("High", updated.Priority);
        Assert.Equal("Personal", updated.Category);
    }
    [Fact]
    public async Task TaskDetails_RequireOwnershipAndPersistChecklist()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var owner = await AuthorizedClientAsync(factory);
        using var otherUser = await AuthorizedClientAsync(factory);
        using var created = await owner.PostAsJsonAsync("/api/tasks", new { title = "Plan launch", dueDate = "2026-11-19" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var task = await created.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(task);
        Assert.Empty(task.Notes);
        Assert.Empty(task.Checklist);

        var url = $"/api/tasks/{task.Id}/details";
        var details = new
        {
            notes = "Review launch criteria.",
            checklist = new[] { new { text = "  Verify build  ", completed = true } }
        };

        using var rejected = await otherUser.PutAsJsonAsync(url, details);
        Assert.Equal(HttpStatusCode.NotFound, rejected.StatusCode);

        using var saved = await owner.PutAsJsonAsync(url, details);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        using var invalid = await owner.PutAsJsonAsync(url, new { notes = new string('x', 4001) });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        using var unchanged = await owner.GetAsync("/api/tasks");
        var priorTasks = await unchanged.Content.ReadFromJsonAsync<TaskItem[]>();
        Assert.Equal(new DateTime(2026, 11, 19), Assert.Single(priorTasks!).DueDate);

        var dateUrl = $"/api/tasks/{task.Id}/due-date";
        var move = new { dueDate = "2026-11-21" };
        using var unauthorizedMove = await otherUser.PutAsJsonAsync(dateUrl, move);
        Assert.Equal(HttpStatusCode.NotFound, unauthorizedMove.StatusCode);

        using var invalidMove = await owner.PutAsJsonAsync(dateUrl, new { dueDate = "2026-11-31" });
        Assert.Equal(HttpStatusCode.BadRequest, invalidMove.StatusCode);

        using var moved = await owner.PutAsJsonAsync(dateUrl, move);
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        using var response = await owner.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var payload = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        var stored = Assert.Single(payload.RootElement.EnumerateArray());
        Assert.Equal("Plan launch", stored.GetProperty("title").GetString());
        Assert.False(stored.GetProperty("completed").GetBoolean());
        Assert.Equal(new DateTime(2026, 11, 21), stored.GetProperty("dueDate").GetDateTime());
        Assert.Equal(details.notes, stored.GetProperty("notes").GetString());
        var step = Assert.Single(stored.GetProperty("checklist").EnumerateArray());
        Assert.Equal("Verify build", step.GetProperty("text").GetString());
        Assert.True(step.GetProperty("completed").GetBoolean());

        using var cleared = await owner.PutAsJsonAsync(url, new
        {
            details.notes,
            details.checklist,
            updateDueDate = true,
            dueDate = (string?)null,
        });
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        var clearedTask = await cleared.Content.ReadFromJsonAsync<TaskItem>();
        Assert.NotNull(clearedTask);
        Assert.Null(clearedTask.DueDate);
    }
}
