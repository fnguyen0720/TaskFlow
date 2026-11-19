public sealed record TaskChecklistItem(string Text, bool Completed);

public sealed record TaskDetailsUpdate(string? Notes, List<TaskChecklistItem?>? Checklist);
