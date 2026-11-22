// Existing two-field checklist entries remain valid and readable.
public sealed record TaskChecklistItem(
    string Text, bool Completed, string? Id = null, string? ParentId = null,
    string Priority = "Medium", DateOnly? DueDate = null);

public static class TaskChecklistValidation
{
    public static bool IsValid(IEnumerable<TaskChecklistItem?> items)
    {
        var steps = items.ToArray();
        if (steps.Length > 30 || steps.Any(s => s is null ||
            string.IsNullOrWhiteSpace(s.Text) || s.Text.Length > 160 ||
            !new[] { "High", "Medium", "Low" }.Contains(s.Priority) ||
            (s.Id is not null && !Guid.TryParse(s.Id, out _)) ||
            (s.ParentId is not null && !Guid.TryParse(s.ParentId, out _))))
            return false;
        var ids = steps.Where(s => s!.Id is not null).Select(s => s!.Id!).ToArray();
        if (ids.Distinct(StringComparer.OrdinalIgnoreCase).Count() != ids.Length)
            return false;
        var byId = steps.Where(s => s!.Id is not null)
            .ToDictionary(s => s!.Id!, s => s!, StringComparer.OrdinalIgnoreCase);
        foreach (var step in steps)
        {
            if (step!.ParentId is null) continue;
            if (step.Id is null || !byId.TryGetValue(step.ParentId, out var parent) ||
                string.Equals(parent.Id, step.Id, StringComparison.OrdinalIgnoreCase) || parent.ParentId is not null)
                return false; // At most one nested level; never cycles.
        }
        return true;
    }
}

public sealed record TaskDetailsUpdate(
    string? Notes,
    List<TaskChecklistItem?>? Checklist,
    bool UpdateDueDate = false,
    DateOnly? DueDate = null);

public sealed record TaskDueDateUpdate(DateOnly? DueDate);

public sealed record GuardedTaskDueDateUpdate(DateOnly? DueDate, DateOnly? ExpectedDueDate);
