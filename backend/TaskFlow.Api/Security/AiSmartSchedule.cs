using System.Globalization;

public static class AiSmartSchedule
{
    public sealed record Request(bool Consent, string? Today, int DailyCapacity);
    public sealed record Slot(int TaskId, string Title, string Priority, string? DueDate,
        string SuggestedDate, string Reason, bool OverCapacity, bool DeadlineAtRisk);
    public sealed record Preview(IReadOnlyList<Slot> Slots);

    public static bool TryRequest(Request request, DateOnly utcToday, out DateOnly start)
    {
        start = default;
        if (request.DailyCapacity is < 1 or > 5 ||
            !DateOnly.TryParseExact(request.Today, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out start))
            return false;
        // The UI sends the user's local calendar date, not a timestamp; tolerate
        // global timezone differences without allowing arbitrary time travel.
        return Math.Abs(start.DayNumber - utcToday.DayNumber) <= 2;
    }

    public static IReadOnlyList<Slot>? Build(
        IReadOnlyList<AiDailyFocus.Suggestion> ranked,
        IReadOnlyList<AiDailyFocus.Candidate> candidates,
        IReadOnlyList<TaskItem> allOpenTasks, DateOnly start, int capacity)
    {
        if (capacity is < 1 or > 5 || ranked.Count is < 1 or > 5) return null;
        var permitted = candidates.ToDictionary(c => c.Id);
        var proposedIds = ranked.Select(p => p.TaskId).ToHashSet();
        if (proposedIds.Count != ranked.Count ||
            ranked.Any(p => !permitted.ContainsKey(p.TaskId))) return null;

        // Existing incomplete tasks already due on a date count toward capacity.
        // Do not count a selected task twice as both a planned work session
        // and a separate existing task on that date.
        var load = new Dictionary<DateOnly, int>();
        foreach (var task in allOpenTasks.Where(t => !t.Completed && !proposedIds.Contains(t.Id)))
        {
            if (!task.DueDate.HasValue) continue;
            var date = DateOnly.FromDateTime(task.DueDate.Value);
            if (date < start || date > start.AddDays(6)) continue;
            load[date] = load.GetValueOrDefault(date) + 1;
        }

        var result = new List<Slot>();
        foreach (var pick in ranked)
        {
            var candidate = permitted[pick.TaskId];
            DateOnly? deadline = null;
            if (candidate.DueDate is { } raw &&
                DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var parsed))
                deadline = parsed;

            var end = start.AddDays(6);
            if (deadline.HasValue && deadline.Value < end) end = deadline.Value;
            if (end < start) end = start;

            // Prefer the earliest date with capacity. When all days are full,
            // show the first least-loaded date with an explicit warning.
            DateOnly? chosen = null;
            var minimum = int.MaxValue;
            for (var date = start; date <= end; date = date.AddDays(1))
            {
                var count = load.GetValueOrDefault(date);
                if (count >= minimum) continue;
                chosen = date;
                minimum = count;
                if (count < capacity) break;
            }
            if (!chosen.HasValue) return null;
            var overCapacity = minimum >= capacity;
            load[chosen.Value] = minimum + 1;
            result.Add(new Slot(candidate.Id, candidate.Title, candidate.Priority,
                candidate.DueDate, chosen.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                pick.Reason, overCapacity, deadline.HasValue && deadline.Value < start));
        }
        return result;
    }
}
