using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

public class TaskItem
{
    public int Id { get; set; }

    public string Title { get; set; } = "";

    public bool Completed { get; set; }

    public string Priority { get; set; } = "Medium";

    public DateTime? DueDate { get; set; }

    public string Category { get; set; } = "General";

    public string RecurrenceRule { get; set; } = "None";

    public int? ReminderDaysBefore { get; set; }

    public string Notes { get; set; } = "";

    [JsonIgnore]
    public string ChecklistJson { get; set; } = "[]";

    [NotMapped]
    public IReadOnlyList<TaskChecklistItem> Checklist =>
        JsonSerializer.Deserialize<TaskChecklistItem[]>(ChecklistJson) ?? [];

    // Read-only fingerprint for opt-in If-Match concurrency protection.
    [NotMapped]
    public string Version => TaskEditVersion.For(this);

    public int? ProjectId { get; set; }

    public string? UserId { get; set; }
}