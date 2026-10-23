using Microsoft.EntityFrameworkCore;

public class PostgreSqlTaskDbContext : TaskDbContext
{
    public PostgreSqlTaskDbContext(
        DbContextOptions<TaskDbContext> options)
        : base(options)
    {
    }
}