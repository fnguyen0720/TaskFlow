using System.Text.Json;
using Microsoft.EntityFrameworkCore;

// Snapshots include user-entered task content. Keep them account-scoped and
// never include them in activity logs, analytics, or unauthenticated responses.
public sealed class TaskVersion
{
    public long Id { get; set; }
    public string UserId { get; set; } = "";
    public int TaskId { get; set; }
    public string Kind { get; set; } = "";
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
    public string Fingerprint { get; set; } = "";
    public string SnapshotJson { get; set; } = "";
}

public sealed record TaskSnapshot(
    string Title, bool Completed, string Priority, DateTime? DueDate,
    string Category, string RecurrenceRule, int? ReminderDaysBefore,
    string Notes, string ChecklistJson, int? ProjectId = null)
{
    public static TaskSnapshot From(TaskItem task) => new(
        task.Title, task.Completed, task.Priority, task.DueDate,
        task.Category, task.RecurrenceRule, task.ReminderDaysBefore,
        task.Notes, task.ChecklistJson, task.ProjectId);

    public TaskItem AsTask() => new() {
        Title = Title, Completed = Completed, Priority = Priority,
        DueDate = DueDate, Category = Category,
        RecurrenceRule = RecurrenceRule, ReminderDaysBefore = ReminderDaysBefore,
        Notes = Notes, ChecklistJson = ChecklistJson, ProjectId = ProjectId
    };
}

public sealed record TaskRestoreRequest(long VersionId);

public static class TaskVersionHistory
{
    public static void Add(TaskDbContext db, TaskItem task, string kind)
    {
        db.TaskVersions.Add(new TaskVersion {
            UserId = task.UserId!,
            TaskId = task.Id,
            Kind = kind,
            Fingerprint = task.Version,
            SnapshotJson = JsonSerializer.Serialize(TaskSnapshot.From(task)),
            RecordedAt = DateTime.UtcNow
        });
    }

    // Existing tasks receive their first baseline only when a real mutation
    // occurs, not when the additive migration is installed.
    public static async Task BaselineIfMissingAsync(TaskDbContext db, TaskItem original)
    {
        if (!await db.TaskVersions.AnyAsync(v =>
            v.UserId == original.UserId && v.TaskId == original.Id))
            Add(db, original, "baseline");
    }

    public static async Task<TaskItem> RecordChangeAsync(
        TaskDbContext db, TaskItem original, string kind)
    {
        await BaselineIfMissingAsync(db, original);
        var current = await db.Tasks.AsNoTracking().SingleAsync(t =>
            t.Id == original.Id && t.UserId == original.UserId);
        Add(db, current, kind);
        return current;
    }

    public static TaskSnapshot Parse(TaskVersion version) =>
        JsonSerializer.Deserialize<TaskSnapshot>(version.SnapshotJson)
        ?? throw new InvalidOperationException("Saved task snapshot is unavailable.");
}
