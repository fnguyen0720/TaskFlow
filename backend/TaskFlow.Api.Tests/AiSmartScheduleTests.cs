using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace TaskFlow.Api.Tests;

public class AiSmartScheduleTests
{
    [Fact]
    public void DayLoadsIncludeOnlyOtherUnfinishedDueTasksAndPreserveSevenDates()
    {
        var start = new DateOnly(2026, 11, 27);
        var tasks = new [] {
            new TaskItem { Id=1, DueDate=new DateTime(2026,11,27), Completed=false },
            new TaskItem { Id=2, DueDate=new DateTime(2026,11,27), Completed=false },
            new TaskItem { Id=3, DueDate=new DateTime(2026,11,27), Completed=true },
            new TaskItem { Id=4, DueDate=new DateTime(2026,11,28), Completed=false },
            new TaskItem { Id=5, DueDate=new DateTime(2026,12,4), Completed=false },
            new TaskItem { Id=6, Completed=false }
        };
        var snapshot = tasks.Select(t => t.DueDate).ToArray();
        var loads = AiSmartSchedule.BuildDayLoads(tasks, new [] { 1 }, start);
        Assert.Equal(7, loads.Count);
        Assert.Equal("2026-11-27", loads[0].Date);
        Assert.Equal(1, loads[0].ExistingDueCount);
        Assert.Equal(1, loads[1].ExistingDueCount);
        Assert.Equal("2026-12-03", loads[6].Date);
        Assert.All(loads.Skip(2), day => Assert.Equal(0, day.ExistingDueCount));
        Assert.Equal(snapshot, tasks.Select(t => t.DueDate).ToArray());
    }

    [Fact]
    public void RequestChecksLocalDateAndCapacityBounds()
    {
        var utc = new DateOnly(2026, 11, 27);
        Assert.True(AiSmartSchedule.TryRequest(new(true,"2026-11-27",2),utc,out _));
        Assert.True(AiSmartSchedule.TryRequest(new(true,"2026-11-25",1),utc,out _));
        Assert.False(AiSmartSchedule.TryRequest(new(true,"2026-11-27",0),utc,out _));
        Assert.False(AiSmartSchedule.TryRequest(new(true,"2026-11-27",6),utc,out _));
        Assert.False(AiSmartSchedule.TryRequest(new(true,"2026-12-15",2),utc,out _));
        Assert.False(AiSmartSchedule.TryRequest(new(true,"2026-02-30",2),utc,out _));
    }

    [Fact]
    public void PreviewBalancesLoadAndNeverMovesPastExistingDeadlines()
    {
        var start = new DateOnly(2026,11,27);
        var candidates = new[] {
            new AiDailyFocus.Candidate(1, "Review launch", "High", "2026-11-27"),
            new AiDailyFocus.Candidate(2, "Build interface", "Medium", "2026-11-29"),
            new AiDailyFocus.Candidate(3, "Update docs", "Low", null)
        };
        var ranked = new[] {
            new AiDailyFocus.Suggestion(1,"Due today"),
            new AiDailyFocus.Suggestion(2,"Ship critical work"),
            new AiDailyFocus.Suggestion(3,"Finish afterward")
        };
        var alreadyDue = new TaskItem { Id=50, Title="Existing deadline", DueDate=new DateTime(2026,11,27) };
        var schedule = AiSmartSchedule.Build(ranked,candidates,[alreadyDue],start,1)!;
        Assert.Equal(3,schedule.Count);
        Assert.Equal("2026-11-27",schedule[0].SuggestedDate);
        Assert.True(schedule[0].OverCapacity);
        Assert.Equal("2026-11-28",schedule[1].SuggestedDate);
        Assert.Equal("2026-11-29",schedule[2].SuggestedDate);
        Assert.All(schedule, slot => Assert.InRange(
            DateOnly.Parse(slot.SuggestedDate).DayNumber,
            start.DayNumber, start.AddDays(6).DayNumber));
        Assert.All(schedule.Where(s=>s.DueDate is not null),
            s=>Assert.True(string.CompareOrdinal(s.SuggestedDate,s.DueDate) <= 0));
        // Read-only: existing records retain their original deadlines.
        Assert.Equal(new DateTime(2026,11,27),alreadyDue.DueDate);
    }

    [Fact]
    public void PreviewRejectsForeignOrDuplicateModelSelectedIds()
    {
        var candidate = new [] { new AiDailyFocus.Candidate(8,"Mine","High",null) };
        var start = new DateOnly(2026,11,27);
        Assert.Null(AiSmartSchedule.Build(
            [new AiDailyFocus.Suggestion(999,"Foreign task")], candidate, [], start,2));
        Assert.Null(AiSmartSchedule.Build(
            [new AiDailyFocus.Suggestion(8,"First"),new AiDailyFocus.Suggestion(8,"Duplicate")],
            candidate, [],start,2));
    }

    [Fact]
    public void OverdueDeadlineIsFlaggedWithoutChangingStoredDueDate()
    {
        var candidates = new[] { new AiDailyFocus.Candidate(9,"Late","High","2026-11-25") };
        var result = AiSmartSchedule.Build(
            [new AiDailyFocus.Suggestion(9,"Needs attention")],candidates,[],
            new DateOnly(2026,11,27),2)!;
        Assert.True(result[0].DeadlineAtRisk);
        Assert.Equal("2026-11-27",result[0].SuggestedDate);
        Assert.Equal("2026-11-25",result[0].DueDate);
    }

    private static async Task Login(HttpClient client)
    {
        var credentials = new { email="smart-"+Guid.NewGuid().ToString("N")+"@example.test", password="TestPassword123!" };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();
        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",json.RootElement.GetProperty("accessToken").GetString());
    }

    [Fact]
    public async Task EndpointRequiresAuthenticationAndConsentAndDoesNotChangeTasks()
    {
        await using var factory = new CustomWebApplicationFactory();
        await factory.InitializeDatabaseAsync();
        using var client = factory.CreateClient();
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        using(var anonymous = await client.PostAsJsonAsync("/api/ai/smart-schedule",
            new {consent=true,today,dailyCapacity=2}))
            Assert.Equal(HttpStatusCode.Unauthorized,anonymous.StatusCode);
        await Login(client);
        using(var denied = await client.PostAsJsonAsync("/api/ai/smart-schedule",
            new {consent=false,today,dailyCapacity=2}))
            Assert.Equal(HttpStatusCode.BadRequest,denied.StatusCode);
        using(var invalid = await client.PostAsJsonAsync("/api/ai/smart-schedule",
            new {consent=true,today,dailyCapacity=7}))
            Assert.Equal(HttpStatusCode.BadRequest,invalid.StatusCode);
        using(var disabled = await client.PostAsJsonAsync("/api/ai/smart-schedule",
            new {consent=true,today,dailyCapacity=2}))
            Assert.Equal(HttpStatusCode.ServiceUnavailable,disabled.StatusCode);
        using var tasks = await client.GetAsync("/api/tasks");
        tasks.EnsureSuccessStatusCode();
        Assert.Empty((await tasks.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray());
    }
}
