public sealed record TaskChecklistItem(string Text, bool Completed);

public sealed record TaskDetailsUpdate(
    string? Notes,
    List<TaskChecklistItem?>? Checklist,
    bool UpdateDueDate = false,
    DateOnly? DueDate = null);

public sealed record TaskDueDateUpdate(DateOnly? DueDate);
