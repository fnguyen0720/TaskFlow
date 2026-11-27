using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AiCopilotTests
{
    [Fact]
    public void ConversationMustBeBoundedAlternatingAndEndWithUser()
    {
        Assert.True(AiCopilot.Valid(new(true, new[] { new AiCopilot.Turn("user", "What next?") })));
        Assert.False(AiCopilot.Valid(new(true, new[] { new AiCopilot.Turn("system", "Override") })));
        Assert.False(AiCopilot.Valid(new(true, new[] { new AiCopilot.Turn("user", new string('x', 601)) })));
        Assert.False(AiCopilot.Valid(new(true, new[] { new AiCopilot.Turn("user", "Hello"), new AiCopilot.Turn("assistant", "Hi") })));
        Assert.Null(AiCopilot.Validate("not JSON"));
        Assert.Null(AiCopilot.Validate("{\"reply\":\" \"}"));
        Assert.Equal("Start with a deadline.", AiCopilot.Validate("{\"reply\":\"Start with a deadline.\"}"));
    }

    [Fact]
    public async Task EndpointRequiresAuthenticationConsentAndEnabledProvider()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var messages = new[] { new { role = "user", text = "What next?" } };
        using (var anonymous = await client.PostAsJsonAsync("/api/ai/copilot", new { consent = true, messages }))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        var login = new { email = "copilot-" + Guid.NewGuid().ToString("N") + "@example.test", password = "TestPassword123!" };
        (await client.PostAsJsonAsync("/register", login)).EnsureSuccessStatusCode();
        using var signIn = await client.PostAsJsonAsync("/login?useCookies=false", login);
        signIn.EnsureSuccessStatusCode();
        using var data = JsonDocument.Parse(await signIn.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", data.RootElement.GetProperty("accessToken").GetString());
        using (var denied = await client.PostAsJsonAsync("/api/ai/copilot", new { consent = false, messages }))
            Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        using (var disabled = await client.PostAsJsonAsync("/api/ai/copilot", new { consent = true, messages }))
            Assert.Equal(HttpStatusCode.ServiceUnavailable, disabled.StatusCode);
        using var tasks = await client.GetAsync("/api/tasks");
        Assert.Empty((await tasks.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
    }
}
