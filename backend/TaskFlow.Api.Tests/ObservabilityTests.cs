using System.Net;
using System.Net.Http.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public sealed class ObservabilityTests
{
    [Fact]
    public void CorrelationId_AcceptsOnlyThirtyTwoHexCharacters()
    {
        const string valid = "0123456789abcdef0123456789abcdef";
        Assert.Equal(valid, RequestObservability.SafeCorrelationId(valid));
        Assert.Matches("^[a-f0-9]{32}$", RequestObservability.SafeCorrelationId("unsafe\nheader"));
        Assert.NotEqual("unsafe\nheader", RequestObservability.SafeCorrelationId("unsafe\nheader"));
    }

    [Fact]
    public async Task AnonymousRequests_GetCorrelatableResponseHeader()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = factory.CreateClient();
        const string id = "0123456789abcdef0123456789abcdef";
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Add(RequestObservability.HeaderName, id);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(id, Assert.Single(response.Headers.GetValues(RequestObservability.HeaderName)));

        using var unauthorized = await client.GetAsync("/api/tasks");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.Matches("^[a-f0-9]{32}$",
            Assert.Single(unauthorized.Headers.GetValues(RequestObservability.HeaderName)));
    }

    [Fact]
    public async Task FrontendReports_AcceptOnlyFixedTaxonomy()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = factory.CreateClient();
        const string id = "0123456789abcdef0123456789abcdef";

        using var accepted = await client.PostAsJsonAsync("/api/diagnostics/frontend",
            new { code = "react_render", area = "ui", correlationId = id });
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);

        using var denied = await client.PostAsJsonAsync("/api/diagnostics/frontend",
            new { code = "react_render userEmail=someone@example.com", area = "ui", correlationId = id });
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);

        using var deniedArea = await client.PostAsJsonAsync("/api/diagnostics/frontend",
            new { code = "react_render", area = "task title private", correlationId = id });
        Assert.Equal(HttpStatusCode.BadRequest, deniedArea.StatusCode);
    }

    [Fact]
    public async Task Cors_ExposesCorrelationHeaderOnlyToTrustedOrigins()
    {
        await using var factory = new CustomWebApplicationFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health/live");
        request.Headers.Add("Origin", "https://task-flow-pi-lake.vercel.app");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(RequestObservability.HeaderName,
            string.Join(",", response.Headers.GetValues("Access-Control-Expose-Headers")));
    }
}
