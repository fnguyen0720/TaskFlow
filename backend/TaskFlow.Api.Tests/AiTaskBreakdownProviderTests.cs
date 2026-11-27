using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AiTaskBreakdownProviderTests
{
    private sealed class StubFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name)
        {
            Assert.Equal("ai-coach", name);
            return client;
        }
    }

    private sealed class InspectRequestHandler : HttpMessageHandler
    {
        public string? Payload { get; private set; }
        public string? Authorization { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://api.openai.com/v1/responses", request.RequestUri?.ToString());
            Authorization = request.Headers.Authorization?.ToString();
            Payload = await request.Content!.ReadAsStringAsync(cancellationToken);
            var aiContent = JsonSerializer.Serialize(new { tasks = new[] {
                new { title = "Outline the project", priority = "High", category = "Work" },
                new { title = "Build a prototype", priority = "Medium", category = "Work" },
                new { title = "Test the release", priority = "Low", category = "Work" }
            }});
            var response = JsonSerializer.Serialize(new { output = new[] {
                new { content = new[] { new { type = "output_text", text = aiContent } } }
            }});
            return new HttpResponseMessage(HttpStatusCode.OK) {
                Content = new StringContent(response, Encoding.UTF8, "application/json")
            };
        }
    }

    [Fact]
    public async Task SendsOnlyExplicitGoalWithStrictSchemaAndParsesBoundedResponse()
    {
        var settings = new Dictionary<string, string?> {
            ["AiCoach:Enabled"] = "true", ["AiCoach:Model"] = "gpt-4o-mini",
            ["OPENAI_API_KEY"] = "test-key-not-real"
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        using var handler = new InspectRequestHandler();
        using var client = new HttpClient(handler);
        var goal = "Build a delightful portfolio website";
        var suggestions = await AiTaskBreakdown.GenerateAsync(
            goal, configuration, new StubFactory(client), CancellationToken.None);
        Assert.Equal(3, suggestions!.Count);
        Assert.Equal("Outline the project", suggestions[0].Title);
        Assert.Equal("Bearer test-key-not-real", handler.Authorization);
        using var body = JsonDocument.Parse(handler.Payload!);
        var root = body.RootElement;
        Assert.Equal(goal, root.GetProperty("input").GetString());
        Assert.False(root.GetProperty("store").GetBoolean());
        var format = root.GetProperty("text").GetProperty("format");
        Assert.Equal("json_schema", format.GetProperty("type").GetString());
        Assert.True(format.GetProperty("strict").GetBoolean());
        Assert.False(format.GetProperty("schema").GetProperty("additionalProperties").GetBoolean());
        Assert.DoesNotContain("taskIds", handler.Payload!);
        Assert.DoesNotContain("userId", handler.Payload!);
    }
}
