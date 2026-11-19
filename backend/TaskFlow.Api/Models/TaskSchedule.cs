public static class TaskSchedule
{
    public static readonly string[] Frequencies = ["None", "Daily", "Weekly", "Monthly"];

    public static string? Validate(TaskItem task)
    {
        if (!Frequencies.Contains(task.RecurrenceRule, StringComparer.Ordinal))
            return "Recurrence must be None, Daily, Weekly, or Monthly.";
        if (task.RecurrenceRule != "None" && task.DueDate is null)
            return "Recurring tasks require a due date.";
        if (task.ReminderDaysBefore is not (null or 0 or 1 or 7))
            return "Reminder must be Off, on due date, 1 day before, or 7 days before.";
        if (task.ReminderDaysBefore.HasValue && task.DueDate is null)
            return "Reminders require a due date.";
        return null;
    }

    public static DateTime NextDueDate(DateTime current, string rule) => rule switch
    {
        "Daily" => current.AddDays(1),
        "Weekly" => current.AddDays(7),
        "Monthly" => current.AddMonths(1),
        _ => throw new ArgumentException("No recurring interval configured.", nameof(rule))
    };

    public static TaskItem NextOccurrence(TaskItem completed) => new()
    {
        Title = completed.Title,
        Priority = completed.Priority,
        Category = completed.Category,
        DueDate = NextDueDate(completed.DueDate!.Value, completed.RecurrenceRule),
        RecurrenceRule = completed.RecurrenceRule,
        ReminderDaysBefore = completed.ReminderDaysBefore,
        UserId = completed.UserId,
        Notes = completed.Notes,
        // New occurrences start incomplete, including all checklist steps.
        ChecklistJson = System.Text.Json.JsonSerializer.Serialize(
            completed.Checklist.Select(step => step with { Completed = false }))
    };
}
