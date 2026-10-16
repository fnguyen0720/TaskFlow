public class TaskItem
{
    public int Id { get; set; }

    public string Title { get; set; } = "";

    public bool Completed { get; set; }

    public string Priority { get; set; } = "Medium";

    public DateTime? DueDate { get; set; }

    public string Category { get; set; } = "General";

    public string? UserId { get; set; }
}