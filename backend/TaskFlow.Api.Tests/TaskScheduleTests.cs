using Xunit;

namespace TaskFlow.Api.Tests;

public sealed class TaskScheduleTests
{
    [Theory]
    [InlineData("Daily", 2026, 1, 31, 2026, 2, 1)]
    [InlineData("Weekly", 2026, 1, 31, 2026, 2, 7)]
    [InlineData("Monthly", 2026, 1, 31, 2026, 2, 28)]
    public void NextDueDate_UsesCalendarSafeDates(
        string recurrence, int y, int m, int d, int ey, int em, int ed)
    {
        Assert.Equal(new DateTime(ey, em, ed),
            TaskSchedule.NextDueDate(new DateTime(y, m, d), recurrence));
    }

    [Fact]
    public void RejectsRecurrenceAndRemindersWithoutDates()
    {
        var task = new TaskItem { Title = "A task", RecurrenceRule = "Weekly" };
        Assert.NotNull(TaskSchedule.Validate(task));
        task.RecurrenceRule = "None";
        task.ReminderDaysBefore = 1;
        Assert.NotNull(TaskSchedule.Validate(task));
        task.DueDate = new DateTime(2026, 11, 19);
        Assert.Null(TaskSchedule.Validate(task));
        task.ReminderDaysBefore = 99;
        Assert.NotNull(TaskSchedule.Validate(task));
    }

    [Fact]
    public void NewOccurrence_IsUncompletedAndResetsChecklist()
    {
        var original = new TaskItem
        {
            Title = "Daily checklist",
            DueDate = new DateTime(2026, 11, 19, 0, 0, 0, DateTimeKind.Utc),
            RecurrenceRule = "Daily", ReminderDaysBefore = 1,
            UserId = "owner", Notes = "Keep instructions",
            ChecklistJson = """[{"Text":"Step","Completed":true}]"""
        };
        var next = TaskSchedule.NextOccurrence(original);
        Assert.Equal(new DateTime(2026, 11, 20, 0, 0, 0, DateTimeKind.Utc), next.DueDate);
        Assert.Equal("owner", next.UserId);
        Assert.False(next.Completed);
        Assert.False(Assert.Single(next.Checklist).Completed);
        Assert.Equal("Keep instructions", next.Notes);
        Assert.Equal(1, next.ReminderDaysBefore);
    }
}
