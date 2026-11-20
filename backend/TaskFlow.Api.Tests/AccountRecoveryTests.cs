using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace TaskFlow.Api.Tests;

public sealed class AccountRecoveryTests
{
    private sealed class TestSender : IEmailSender<ApplicationUser>
    {
        public string? ConfirmationLink { get; private set; }
        public string? ResetCode { get; private set; }
        public int ResetRequests { get; private set; }

        public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink)
        {
            ConfirmationLink = WebUtility.HtmlDecode(confirmationLink);
            return Task.CompletedTask;
        }
        public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode)
        {
            ResetCode = WebUtility.HtmlDecode(resetCode);
            ResetRequests++;
            return Task.CompletedTask;
        }
        public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
            throw new NotSupportedException();
    }

    private sealed class TestFactory : CustomWebApplicationFactory
    {
        public TestSender Email { get; } = new();

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailSender<ApplicationUser>>();
                services.AddSingleton<IEmailSender<ApplicationUser>>(Email);
            });
        }
    }

    [Fact]
    public async Task RecoveryCapability_IsDisabledWithoutProvider_AndHostIsNotTrusted()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build();
        var delivery = new AccountEmailDelivery(config);
        Assert.False(delivery.Enabled);
        Assert.Throws<InvalidOperationException>(() => delivery.TrustedConfirmationLink(
            "https://attacker.invalid/confirmEmail?userId=x&code=y"));

        var partial = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
        {
            ["Email:ResendApiKey"] = "secret-for-test"
        }).Build();
        Assert.Throws<InvalidOperationException>(() => new AccountEmailDelivery(partial));

        var complete = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
        {
            ["Email:ResendApiKey"] = "fake-key",
            ["Email:FromAddress"] = "TaskFlow <no-reply@example.test>",
            ["Email:PublicApiOrigin"] = "https://api.example.test",
            ["Email:FrontendOrigin"] = "https://app.example.test"
        }).Build();
        var enabled = new AccountEmailDelivery(complete);
        Assert.True(enabled.Enabled);
        Assert.Equal("https://api.example.test/confirmEmail?userId=x&code=y",
            enabled.TrustedConfirmationLink("https://attacker.invalid/confirmEmail?userId=x&amp;code=y"));
        Assert.StartsWith("https://app.example.test/#resetPassword=",
            enabled.ResetLink("test@example.test", "abc-123"));
    }

    private sealed class PartialProviderFactory : CustomWebApplicationFactory
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Email:ResendApiKey"] = "partial-test-key"
                }));
        }
    }

    [Fact]
    public void IncompleteEmailConfiguration_RefusesStartupBeforeRequests()
    {
        using var factory = new PartialProviderFactory();
        var exception = Assert.ThrowsAny<Exception>(() => factory.CreateClient());
        Assert.Contains("Email delivery requires all four Email settings.",
            exception.ToString());
    }

    [Fact]
    public async Task IdentityConfirmationAndPasswordReset_AreSingleUseAndNonEnumerating()
    {
        await using var factory = new TestFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost")
        });
        using var capability = await client.GetAsync("/api/account/capabilities");
        Assert.Equal(HttpStatusCode.OK, capability.StatusCode);
        var cap = await capability.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(cap.GetProperty("emailDeliveryEnabled").GetBoolean());

        var email = $"recovery-{Guid.NewGuid():N}@example.test";
        const string originalPassword = "OriginalPassword123!";
        const string updatedPassword = "ChangedPassword123!";
        using var registration = await client.PostAsJsonAsync("/register", new
        {
            email, password = originalPassword
        });
        Assert.Equal(HttpStatusCode.OK, registration.StatusCode);
        Assert.NotNull(factory.Email.ConfirmationLink);

        using var unverifiedReset = await client.PostAsJsonAsync("/forgotPassword", new { email });
        Assert.Equal(HttpStatusCode.OK, unverifiedReset.StatusCode);
        Assert.Equal(0, factory.Email.ResetRequests);

        using var confirmation = await client.GetAsync(new Uri(factory.Email.ConfirmationLink!).PathAndQuery);
        Assert.Equal(HttpStatusCode.OK, confirmation.StatusCode);
        using var unknown = await client.PostAsJsonAsync("/forgotPassword", new
        {
            email = $"missing-{Guid.NewGuid():N}@example.test"
        });
        Assert.Equal(HttpStatusCode.OK, unknown.StatusCode);
        Assert.Equal(0, factory.Email.ResetRequests);

        using var forgot = await client.PostAsJsonAsync("/forgotPassword", new { email });
        Assert.Equal(HttpStatusCode.OK, forgot.StatusCode);
        Assert.Equal(1, factory.Email.ResetRequests);
        var code = factory.Email.ResetCode;
        Assert.False(string.IsNullOrWhiteSpace(code));
        using var reset = await client.PostAsJsonAsync("/resetPassword", new
        {
            email, resetCode = code, newPassword = updatedPassword
        });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        using var replay = await client.PostAsJsonAsync("/resetPassword", new
        {
            email, resetCode = code, newPassword = "AnotherPassword123!"
        });
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);

        using var oldLogin = await client.PostAsJsonAsync("/login?useCookies=false", new
        {
            email, password = originalPassword
        });
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);
        using var newLogin = await client.PostAsJsonAsync("/login?useCookies=false", new
        {
            email, password = updatedPassword
        });
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }
}
