public sealed record FrontendDiagnostic(string? Code, string? Area, string? CorrelationId);

public static class FrontendDiagnosticValidator
{
    private static readonly HashSet<string> Codes = new(StringComparer.Ordinal)
    {
        "unexpected_js", "unhandled_rejection", "react_render", "network_failure", "api_failure"
    };

    private static readonly HashSet<string> Areas = new(StringComparer.Ordinal)
    {
        "ui", "authentication", "tasks", "calendar", "details", "deletion"
    };

    public static bool IsValid(FrontendDiagnostic? report) =>
        report is not null &&
        report.Code is not null && Codes.Contains(report.Code) &&
        report.Area is not null && Areas.Contains(report.Area) &&
        report.CorrelationId is { Length: 32 } &&
        Guid.TryParseExact(report.CorrelationId, "N", out _);
}
