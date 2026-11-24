using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

// The language model only sees anonymized, server-derived counts. Raw titles,
// descriptions, notes, checklist items, task IDs and account identities never leave TaskFlow.
public static class AiCoachExplanation
{
    private static readonly HashSet<string> AllowedInsights = new(StringComparer.Ordinal)
    {
        "blocked-deadline", "shared-prerequisite", "overdue-ready",
        "recent-activity", "busy-week", "steady"
    };

    public static bool IsEnabled(IConfiguration configuration) =>
        configuration.GetValue<bool>("AiCoach:Enabled") &&
        !string.IsNullOrWhiteSpace(configuration["OPENAI_API_KEY"]);

    public static bool IsAllowed(string? insightId) =>
        insightId is not null && AllowedInsights.Contains(insightId);

    // The user chooses an insight code, never untrusted model instructions or a task ID.
    // Only evaluate this user's records. No live user-entered text is retrieved.
    public static async Task<string?> GetEvidenceAsync(
        TaskDbContext db, string userId, string insightId, CancellationToken cancellationToken)
    {
        var tasks = await db.Tasks.AsNoTracking().Where(t => t.UserId == userId)
            .Select(t => new { t.Id, t.Completed, t.DueDate, t.Priority })
            .ToListAsync(cancellationToken);
        var active = tasks.Where(t => !t.Completed).ToArray();
        var map = tasks.ToDictionary(t => t.Id);
        var links = await db.TaskDependencies.AsNoTracking()
            .Join(db.Tasks.AsNoTracking().Where(t => t.UserId == userId),
                link => link.TaskId, t => t.Id, (link, t) => link)
            .Join(db.Tasks.AsNoTracking().Where(t => t.UserId == userId),
                link => link.DependsOnTaskId, t => t.Id,
                (link, t) => new { link.TaskId, link.DependsOnTaskId })
            .ToListAsync(cancellationToken);
        var unresolved = links.Where(e => map.TryGetValue(e.TaskId, out var task) &&
            !task.Completed && map.TryGetValue(e.DependsOnTaskId, out var prereq) &&
            !prereq.Completed).ToArray();
        var blocked = unresolved.Select(e => e.TaskId).Distinct().ToHashSet();
        var today = DateTime.UtcNow.Date;
        var urgentBlocked = active.Count(t => blocked.Contains(t.Id) &&
            t.DueDate.HasValue && t.DueDate.Value.Date <= today.AddDays(7));
        var maxUnblockedByOne = unresolved.GroupBy(e => e.DependsOnTaskId)
            .Select(g => g.Select(e => e.TaskId).Distinct().Count()).DefaultIfEmpty(0).Max();
        var overdueReady = active.Count(t => !blocked.Contains(t.Id) &&
            t.DueDate.HasValue && t.DueDate.Value.Date < today);
        var dueSoon = active.Count(t => t.DueDate.HasValue &&
            t.DueDate.Value.Date >= today && t.DueDate.Value.Date < today.AddDays(7));
        var current = await db.TaskActivities.AsNoTracking().CountAsync(a =>
            a.UserId == userId && a.Kind == TaskActivityKinds.Completed &&
            a.OccurredAt >= today.AddDays(-6) && a.OccurredAt < today.AddDays(1), cancellationToken);
        var previous = await db.TaskActivities.AsNoTracking().CountAsync(a =>
            a.UserId == userId && a.Kind == TaskActivityKinds.Completed &&
            a.OccurredAt >= today.AddDays(-13) && a.OccurredAt < today.AddDays(-6), cancellationToken);
        var present = insightId switch
        {
            "blocked-deadline" => urgentBlocked > 0,
            "shared-prerequisite" => maxUnblockedByOne > 0,
            "overdue-ready" => overdueReady > 0,
            "recent-activity" => previous >= 3 && current * 2 < previous,
            "busy-week" => dueSoon >= 5,
            "steady" => urgentBlocked == 0 && maxUnblockedByOne == 0 &&
                overdueReady == 0 && dueSoon < 5 && !(previous >= 3 && current * 2 < previous),
            _ => false
        };
        if (!present) return null; // Ignore stale/malicious insight codes.
        // No task content, IDs, names, user identifiers or timestamps of private actions.
        return $"Selected insight: {insightId}. Active tasks: {active.Length}. " +
            $"Blocked tasks: {blocked.Count}. Blocked and due within seven days or overdue: {urgentBlocked}. " +
            $"Maximum active tasks directly waiting on one prerequisite: {maxUnblockedByOne}. " +
            $"Unblocked overdue tasks: {overdueReady}. Active tasks due within seven days: {dueSoon}. " +
            $"Recorded completion events in the last seven UTC calendar days: {current}; " +
            $"in the previous seven: {previous}. These are event counts, not unique tasks. " +
            "History may be incomplete before activity tracking was introduced.";
    }

    public static async Task<string?> GenerateAsync(
        string evidence, IConfiguration configuration, IHttpClientFactory clients,
        CancellationToken cancellationToken)
    {
        var model = configuration["AiCoach:Model"];
        if (string.IsNullOrWhiteSpace(model)) model = "gpt-4o-mini";
        var payload = new
        {
            model,
            store = false,
            max_output_tokens = 230,
            instructions = "You are an optional task-planning coach. Write 2-4 concise plain-text sentences based ONLY on the provided aggregated facts. Explain the selected bottleneck and suggest one practical, healthy next action. Do not invent task names, deadlines, personal characteristics, activity dates or project details. Do not make edits. This is not a judgment of productivity. No links or markdown.",
            input = evidence
        };
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/responses");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", configuration["OPENAI_API_KEY"]);
        request.Content = JsonContent.Create(payload);
        using var response = await clients.CreateClient("ai-coach").SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;
        await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var data = await JsonDocument.ParseAsync(body, cancellationToken: cancellationToken);
        if (!data.RootElement.TryGetProperty("output", out var output) ||
            output.ValueKind != JsonValueKind.Array) return null;
        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var contents) ||
                contents.ValueKind != JsonValueKind.Array) continue;
            foreach (var part in contents.EnumerateArray())
            {
                if (part.TryGetProperty("type", out var type) &&
                    type.GetString() == "output_text" &&
                    part.TryGetProperty("text", out var value) && value.ValueKind == JsonValueKind.String)
                {
                    var answer = value.GetString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(answer) && answer.Length <= 1500)
                        return answer;
                }
            }
        }
        return null;
    }
}

public sealed record AiCoachExplainRequest(string? InsightId);
