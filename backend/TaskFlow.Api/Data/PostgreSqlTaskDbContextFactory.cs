using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Npgsql;

public class PostgreSqlTaskDbContextFactory
    : IDesignTimeDbContextFactory<PostgreSqlTaskDbContext>
{
    public PostgreSqlTaskDbContext CreateDbContext(string[] args)
    {
        var databaseUrl =
            Environment.GetEnvironmentVariable("TASKFLOW_POSTGRES_CONNECTION");

        string connectionString;

        if (!string.IsNullOrWhiteSpace(databaseUrl) &&
            Uri.TryCreate(databaseUrl, UriKind.Absolute, out var databaseUri) &&
            (databaseUri.Scheme == "postgres" ||
             databaseUri.Scheme == "postgresql"))
        {
            var credentials = databaseUri.UserInfo.Split(':', 2);

            if (credentials.Length != 2)
            {
                throw new InvalidOperationException(
                    "Invalid PostgreSQL URL credentials.");
            }

            var builder = new NpgsqlConnectionStringBuilder
            {
                Host = databaseUri.Host,
                Port = databaseUri.Port > 0 ? databaseUri.Port : 5432,
                Database = databaseUri.AbsolutePath.TrimStart('/'),
                Username = Uri.UnescapeDataString(credentials[0]),
                Password = Uri.UnescapeDataString(credentials[1]),
                SslMode = SslMode.Require
            };

            connectionString = builder.ConnectionString;
        }
        else
        {
            connectionString =
                "Host=localhost;Database=taskflow_dev;" +
                "Username=postgres;Password=postgres";
        }

        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable(
                    "__EFMigrationsHistory",
                    "public"))
            .Options;

        return new PostgreSqlTaskDbContext(options);
    }
}