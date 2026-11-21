using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AccountIdentityTests
{
    private static async Task<string> RegisterAndLoginAsync(HttpClient client, string email)
    {
        var credentials = new { email, password = "TestPassword123!" };
        using var register = await client.PostAsJsonAsync("/register", credentials);
        register.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        var payload = await login.Content.ReadFromJsonAsync<LoginToken>();
        Assert.NotNull(payload);
        return payload.AccessToken;
    }

    private sealed record LoginToken(string AccessToken);
    private sealed record AccountIdentity(string Email);

    [Fact]
    public async Task AccountIdentity_RequiresAuthentication()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/api/account/me");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AccountIdentity_ReturnsOnlyOwnEmail_WithoutCaching()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var firstEmail = $"account-identity-a-{Guid.NewGuid():N}@example.test";
        var secondEmail = $"account-identity-b-{Guid.NewGuid():N}@example.test";
        var tokenA = await RegisterAndLoginAsync(client, firstEmail);
        var tokenB = await RegisterAndLoginAsync(client, secondEmail);

        foreach (var (token, expectedEmail, otherEmail) in new[]
        {
            (tokenA, firstEmail, secondEmail),
            (tokenB, secondEmail, firstEmail),
            (tokenA, firstEmail, secondEmail)
        })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/account/me");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            var json = await response.Content.ReadAsStringAsync();
            Assert.Contains(expectedEmail, json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(otherEmail, json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("password", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("securityStamp", json, StringComparison.OrdinalIgnoreCase);
            var identity = await response.Content.ReadFromJsonAsync<AccountIdentity>();
            Assert.Equal(expectedEmail, identity?.Email);
        }
    }
}
