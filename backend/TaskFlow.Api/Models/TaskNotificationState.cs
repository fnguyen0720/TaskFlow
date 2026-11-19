// State is deliberately separate from task contents. All lookups are scoped to
// the authenticated user, and task ownership is checked on every write.
public sealed class TaskNotificationState
{
    public string UserId { get; set; } = "";
    public int TaskId { get; set; }
    public string Kind { get; set; } = "";
    public bool IsRead { get; set; }
    public bool IsDismissed { get; set; }
}

public sealed record NotificationStateUpdate(string? Action);

public static class TaskNotificationKinds
{
    public static bool IsValid(string kind) =>
        kind is "overdue" or "due-today" or "upcoming";
    public static bool IsValidAction(string? action) =>
        action is "read" or "dismiss";
}
