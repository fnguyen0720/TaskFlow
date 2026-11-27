using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AiRateLimitFeedbackTests
{
    [Fact]
    public async Task AiRejectionProvidesRealRetryAfterWithoutChangingRequestLimits()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var credentials = new {
            email = "ai-cooldown-" + Guid.NewGuid().ToString("N") + "@example.test",
            password = "TestPassword123!"
        };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", json.RootElement.GetProperty("accessToken").GetString());

        // Consent-denied requests are safe and never call the inference model.
        // The middleware counts the same five requests across AI endpoints.
        for (var i = 0; i < 5; i++)
        {
            var endpoint = i % 2 == 0
                ? "/api/ai/smart-schedule" : "/api/ai/daily-focus";
            using var allowed = await client.PostAsJsonAsync(endpoint,
                new { consent = false, today = DateTime.UtcNow.ToString("yyyy-MM-dd"), dailyCapacity = 2 });
            Assert.Equal(HttpStatusCode.BadRequest, allowed.StatusCode);
        }

        using var limited = await client.PostAsJsonAsync("/api/ai/smart-schedule",
            new { consent = true, today = DateTime.UtcNow.ToString("yyyy-MM-dd"), dailyCapacity = 2 });
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(limited.Headers.RetryAfter?.Delta is { } seconds && seconds > TimeSpan.Zero);
        Assert.InRange(limited.Headers.RetryAfter!.Delta!.Value.TotalSeconds, 1, 600);
        Assert.DoesNotContain("authentication",
            (await limited.Content.ReadAsStringAsync()).ToLowerInvariant());
    }
}
