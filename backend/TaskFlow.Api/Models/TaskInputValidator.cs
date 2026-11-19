// Validate values accepted from clients before persisting TaskItem entities.
// Keep this in one place so create and edit enforce the same rules.
public static class TaskInputValidator
{
    private static readonly HashSet<string> AllowedPriorities =
        new(StringComparer.Ordinal) { "Low", "Medium", "High" };

    private static readonly HashSet<string> AllowedCategories =
        new(StringComparer.Ordinal) { "General", "Work", "Study", "Personal" };

    public static string? Validate(TaskItem task)
    {
        if (string.IsNullOrWhiteSpace(task.Title))
        {
            return "Task title cannot be empty.";
        }

        if (task.Title.Trim().Length > 100)
        {
            return "Task title cannot exceed 100 characters.";
        }

        if (task.Priority is null || !AllowedPriorities.Contains(task.Priority))
        {
            return "Priority must be Low, Medium, or High.";
        }

        if (task.Category is null || !AllowedCategories.Contains(task.Category))
        {
            return "Category must be General, Work, Study, or Personal.";
        }

        return null;
    }
}
