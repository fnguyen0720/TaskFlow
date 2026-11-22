// A project belongs to exactly one account. Task assignment is always checked
// against the authenticated owner's project, never a client-supplied user ID.
public sealed class TaskProject
{
    public int Id { get; set; }
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed record ProjectCreateRequest(string? Name);
public sealed record ProjectAssignRequest(int? ProjectId);
