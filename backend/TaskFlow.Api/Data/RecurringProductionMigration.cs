using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

// The production Render service automatically deploys main. Apply the
// backward-compatible schema expansion before the new API starts accepting
// traffic; the old API tolerates these extra nullable/defaulted columns.
public static class RecurringProductionMigration
{
    private const string Prerequisite = "20261119164957_AddTaskDetails";
    private const string Target = "20261119210001_AddRecurrenceAndRemindersPostgres";
    private const string NotificationsTarget = "20261119230001_AddNotificationStatesPostgres";
    private const string PreferencesTarget = "20261120150001_AddNotificationPreferencesPostgres";

    public static async Task EnsureAppliedAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var options = scope.ServiceProvider
            .GetRequiredService<DbContextOptions<TaskDbContext>>();
        await using var db = new PostgreSqlTaskDbContext(options);
        var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
        if (!applied.Contains(Prerequisite, StringComparer.Ordinal))
        {
            throw new InvalidOperationException(
                "Required production schema migration is missing; refusing to start.");
        }

        var pending = (await db.Database.GetPendingMigrationsAsync()).ToArray();
        if (pending.Any(id => id != Target && id != NotificationsTarget && id != PreferencesTarget))
        {
            throw new InvalidOperationException(
                "Unexpected PostgreSQL migrations are pending; refusing automatic schema changes.");
        }

        // No new migrations needed on subsequent deployments. MigrateAsync
        // uses EF Core's migration coordination and is safe to invoke repeatedly.
        await db.Database.MigrateAsync();

        var remaining = (await db.Database.GetPendingMigrationsAsync()).ToArray();
        if (remaining.Length != 0)
            throw new InvalidOperationException(
                "PostgreSQL schema upgrade did not complete; refusing to start.");

        var logger = scope.ServiceProvider
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("TaskFlow.Database.Migration");
        logger.LogInformation("TaskFlow recurring-task database schema is current.");
    }
}
