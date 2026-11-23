// A directed edge: TaskId cannot be completed until DependsOnTaskId is complete.
// Ownership is checked against both tasks on every API operation.
public sealed class TaskDependency
{
    public int TaskId { get; set; }
    public int DependsOnTaskId { get; set; }
}
public sealed record TaskDependenciesUpdate(List<int>? DependsOnIds, List<int>? ExpectedDependsOnIds);
