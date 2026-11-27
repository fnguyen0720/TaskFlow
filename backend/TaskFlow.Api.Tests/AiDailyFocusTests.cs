using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AiDailyFocusTests
{
    [Fact]
    public void CandidateSelectionExcludesCompletedAndCapsDisclosure()
    {
        var tasks = Enumerable.Range(1, 30).Select(i => new TaskItem {
            Id = i, Title = "Task " + i, Priority = i % 2 == 0 ? "High" : "Low",
            Completed = i == 1, DueDate = i < 5 ? new DateTime(2026, 11, i + 1) : null
        }).ToArray();
        var selected = AiDailyFocus.SelectCandidates(tasks);
        Assert.Equal(15, selected.Count);
        Assert.DoesNotContain(selected, t => t.Id == 1);
        Assert.Equal(2, selected[0].Id);
        Assert.DoesNotContain(selected, t => t.Id > 30);
    }

    [Fact]
    public void RejectsInventedAndDuplicatedTaskIdsAndUnsafeReasons()
    {
        var candidates = new [] {
            new AiDailyFocus.Candidate(12, "Owner task", "High", "2026-11-27"),
            new AiDailyFocus.Candidate(13, "Another owner task", "Medium", null)
        };
        Assert.Null(AiDailyFocus.Validate(null, candidates));
        Assert.Null(AiDailyFocus.Validate("not json", candidates));
        Assert.Null(AiDailyFocus.Validate("{\"picks\":[{\"taskId\":999,\"reason\":\"Do it\"}]}", candidates));
        Assert.Null(AiDailyFocus.Validate("{\"picks\":[{\"taskId\":12,\"reason\":\"Do it\"},{\"taskId\":12,\"reason\":\"Again\"}]}", candidates));
        Assert.Null(AiDailyFocus.Validate("{\"picks\":[{\"taskId\":12,\"reason\":\" \"}]}", candidates));
        Assert.Null(AiDailyFocus.Validate("{\"picks\":[{\"taskId\":12,\"reason\":\"Bad\\ntext\"}]}", candidates));
        var good = AiDailyFocus.Validate("{\"picks\":[{\"taskId\":13,\"reason\":\"This is a good next step\"}]}", candidates);
        Assert.Equal(13, Assert.Single(good!).TaskId);
    }

    private sealed class FakeClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) {
            Assert.Equal("ai-coach", name);
            return client;
        }
    }

    private sealed class FakeResponseHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }
        public string? Auth { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("https://api.openai.com/v1/responses", request.RequestUri!.ToString());
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            Auth = request.Headers.Authorization?.ToString();
            var content = JsonSerializer.Serialize(new {
                picks = new [] { new { taskId = 12, reason = "Important deadline" } }
            });
            return new HttpResponseMessage(HttpStatusCode.OK) {
                Content = new StringContent(JsonSerializer.Serialize(new {
                    output = new [] {
                        new { content = new [] { new { type = "output_text", text = content } } }
                    }
                }), Encoding.UTF8, "application/json")
            };
        }
    }

    [Fact]
    public async Task ProviderReceivesOnlyBoundedTaskFieldsAndCannotReturnAnUnknownId()
    {
        var settings = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string,string?> {
                ["OPENAI_API_KEY"] = "only-a-test-key",
                ["AiCoach:Model"] = "gpt-4o-mini"
            }).Build();
        using var handler = new FakeResponseHandler();
        using var client = new HttpClient(handler);
        var allowed = new [] { new AiDailyFocus.Candidate(12, "Complete login tests", "High", "2026-11-27") };
        var picks = await AiDailyFocus.GenerateAsync(allowed, settings, new FakeClientFactory(client), CancellationToken.None);
        Assert.Equal(12, Assert.Single(picks!).TaskId);
        Assert.Equal("Bearer only-a-test-key", handler.Auth);
        using var body = JsonDocument.Parse(handler.Body!);
        Assert.False(body.RootElement.GetProperty("store").GetBoolean());
        var provided = body.RootElement.GetProperty("input").GetString()!;
        Assert.Contains("Complete login tests", provided);
        Assert.DoesNotContain("UserId", provided);
        Assert.DoesNotContain("notes", provided, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("checklist", provided, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task Login(HttpClient client)
    {
        var login = new { email = "daily-" + Guid.NewGuid().ToString("N") + "@example.test", password = "TestPassword123!" };
        using var registration = await client.PostAsJsonAsync("/register", login);
        registration.EnsureSuccessStatusCode();
        using var signIn = await client.PostAsJsonAsync("/login?useCookies=false", login);
        signIn.EnsureSuccessStatusCode();
        using var data = JsonDocument.Parse(await signIn.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer", data.RootElement.GetProperty("accessToken").GetString());
    }

    [Fact]
    public async Task EndpointRequiresAuthenticationConsentAndServerConfiguration()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        using (var anonymous = await client.PostAsJsonAsync("/api/ai/daily-focus", new { consent = true }))
            Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        await Login(client);
        using (var nonconsented = await client.PostAsJsonAsync("/api/ai/daily-focus", new { consent = false }))
            Assert.Equal(HttpStatusCode.BadRequest, nonconsented.StatusCode);
        using (var disabled = await client.PostAsJsonAsync("/api/ai/daily-focus", new { consent = true }))
            Assert.Equal(HttpStatusCode.ServiceUnavailable, disabled.StatusCode);
        using var existing = await client.GetAsync("/api/tasks");
        Assert.Empty((await existing.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
    }
}
