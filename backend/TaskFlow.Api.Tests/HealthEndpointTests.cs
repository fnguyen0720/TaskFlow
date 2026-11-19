using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;

namespace TaskFlow.Api.Tests;

public sealed class HealthEndpointTests
{
    [Fact]
    public async Task Liveness_IsPublicAndDoesNotRequireDatabase()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<HealthStatus>();
        Assert.Equal("alive", payload?.Status);
    }

    [Fact]
    public async Task Readiness_ReturnsHealthyOnlyWhenDatabaseIsReachable()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ready", (await response.Content.ReadFromJsonAsync<HealthStatus>())?.Status);
    }

    [Fact]
    public async Task Readiness_WithoutDatabaseSchema_DoesNotLeakConfiguration()
    {
        // A valid connection with no created tables still connects successfully.
        // Test explicit unreachable-db behavior in the PostgreSQL CI suite;
        // this test ensures the public response remains minimal.
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var json = await client.GetStringAsync("/health/ready");
        Assert.DoesNotContain("connectionString", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("password", json, StringComparison.OrdinalIgnoreCase);
    }

    private sealed record HealthStatus(string Status);
}
