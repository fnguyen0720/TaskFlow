using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

// Version strings are derived from the current persisted task fields, without
// storing new columns or migrating production task records. Guarded writes use
// an atomic WHERE comparison against the same snapshot (not a read-then-write).
public static class TaskEditVersion
{
    public static string For(TaskItem task)
    {
        var payload = JsonSerializer.Serialize(new
        {
            task.Id, task.Title, task.Completed, task.Priority, task.DueDate,
            task.Category, task.RecurrenceRule, task.ReminderDaysBefore,
            task.Notes, task.ChecklistJson, task.UserId
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    // If-Match is opt-in while older clients are upgraded. Reject invalid,
    // wildcard and multiple preconditions; no silent fallback for malformed data.
    public static bool IsValid(string? header) =>
        header is not null && header.Length == 66 && header[0] == '"' &&
        header[^1] == '"' && header[1..^1].All(Uri.IsHexDigit);

    public static IQueryable<TaskItem> Unchanged(
        IQueryable<TaskItem> tasks, TaskItem original) =>
        tasks.Where(t => t.Id == original.Id && t.UserId == original.UserId &&
            t.Title == original.Title && t.Completed == original.Completed &&
            t.Priority == original.Priority && t.DueDate == original.DueDate &&
            t.Category == original.Category &&
            t.RecurrenceRule == original.RecurrenceRule &&
            t.ReminderDaysBefore == original.ReminderDaysBefore &&
            t.Notes == original.Notes && t.ChecklistJson == original.ChecklistJson);
}
