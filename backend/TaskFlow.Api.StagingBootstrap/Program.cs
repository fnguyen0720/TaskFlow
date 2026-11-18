using Microsoft.EntityFrameworkCore;

if (args.Length != 1)
{
    throw new ArgumentException("Expected a single disposable SQLite database path.");
}

// This bootstrap is intentionally limited to the isolated GitHub Actions
// test branch. It never connects to Render or a production database.
var connectionString = $"Data Source={args[0]}";
var options = new DbContextOptionsBuilder<TaskDbContext>()
    .UseSqlite(connectionString)
    .Options;

await using var db = new TaskDbContext(options);
await db.Database.EnsureCreatedAsync();
Console.WriteLine("STAGING_DATABASE_INITIALIZED");
