using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;

public static class RequestObservability
{
    public const string HeaderName = "X-Request-ID";

    public static string SafeCorrelationId(string? supplied) =>
        supplied is { Length: 32 } && Guid.TryParseExact(supplied, "N", out _)
            ? supplied.ToLowerInvariant()
            : Guid.NewGuid().ToString("N");

    public static async Task InvokeAsync(HttpContext context, RequestDelegate next, ILogger logger)
    {
        var supplied = context.Request.Headers[HeaderName];
        var id = SafeCorrelationId(supplied.Count == 1 ? supplied[0] : null);
        context.Response.Headers[HeaderName] = id;
        context.TraceIdentifier = id;
        var start = Stopwatch.GetTimestamp();
        using var scope = logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id });

        try
        {
            await next(context);
        }
        finally
        {
            var endpoint = context.GetEndpoint() as RouteEndpoint;
            // A route *pattern* is safe; a raw URL can contain user IDs and query secrets.
            var route = endpoint?.RoutePattern.RawText ?? "unmatched";
            var elapsed = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            var status = context.Response.StatusCode;
            if (status >= 500)
            {
                logger.LogWarning(
                    "request_completed correlation_id={CorrelationId} method={Method} route={Route} status={Status} duration_ms={DurationMs}",
                    id, context.Request.Method, route, status, Math.Round(elapsed, 1));
            }
            else if (!route.StartsWith("/health/", StringComparison.OrdinalIgnoreCase))
            {
                logger.LogInformation(
                    "request_completed correlation_id={CorrelationId} method={Method} route={Route} status={Status} duration_ms={DurationMs}",
                    id, context.Request.Method, route, status, Math.Round(elapsed, 1));
            }
        }
    }
}
