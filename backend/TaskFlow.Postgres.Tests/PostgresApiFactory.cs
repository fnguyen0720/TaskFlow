using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Xunit;

namespace TaskFlow.Postgres.Tests;

/// <summary>
/// Hard isolation boundary: this suite only accepts the disposable local CI
/// database. Never point it at Render or a shared development database.
/// </summary>
public sealed class PostgresApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private const string TestDatabase = "taskflow_integration";
    private readonly string _connectionString = RequireLocalTestDatabase();

    public static string RequireLocalTestDatabase()
    {
        var raw = Environment.GetEnvironmentVariable("TASKFLOW_INTEGRATION_POSTGRES");
        if (string.IsNullOrWhiteSpace(raw))
        {
            throw new InvalidOperationException(
                "Set TASKFLOW_INTEGRATION_POSTGRES to a disposable, local PostgreSQL database.");
        }

        var connection = new NpgsqlConnectionStringBuilder(raw);
        if (connection.Database != TestDatabase ||
            connection.Host is not ("127.0.0.1" or "localhost" or "::1") ||
            connection.Username != "taskflow_test")
        {
            throw new InvalidOperationException(
                "Integration tests require the local taskflow_integration database " +
                "with user taskflow_test. Remote or production databases are prohibited.");
        }

        return connection.ConnectionString;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DatabaseProvider"] = "Postgres",
                ["DATABASE_URL"] = _connectionString,
                ["ConnectionStrings:DefaultConnection"] = _connectionString,
            }));
    }

    public async Task InitializeAsync()
    {
        // The PostgreSQL migration set is bound to PostgreSqlTaskDbContext,
        // while the running API resolves TaskDbContext. Apply the real migrations
        // through the migration context before booting the API.
        var options = new DbContextOptionsBuilder<TaskDbContext>()
            .UseNpgsql(_connectionString, postgres =>
                postgres.MigrationsHistoryTable("__EFMigrationsHistory", "public"))
            .Options;
        await using var migrationDb = new PostgreSqlTaskDbContext(options);
        await migrationDb.Database.MigrateAsync();
    }

    Task IAsyncLifetime.DisposeAsync()
    {
        Dispose();
        return Task.CompletedTask;
    }

    public HttpClient NewClient() => CreateClient(new WebApplicationFactoryClientOptions
    {
        BaseAddress = new Uri("https://localhost")
    });

    public async Task<HttpClient> AuthenticatedClientAsync()
    {
        var client = NewClient();
        var credentials = new
        {
            email = $"postgres-{Guid.NewGuid():N}@example.test",
            password = "TestPassword123!"
        };
        using var registration = await client.PostAsJsonAsync("/register", credentials);
        registration.EnsureSuccessStatusCode();

        using var login = await client.PostAsJsonAsync("/login?useCookies=false", credentials);
        login.EnsureSuccessStatusCode();
        var tokens = await login.Content.ReadFromJsonAsync<LoginTokens>();
        Assert.False(string.IsNullOrWhiteSpace(tokens?.AccessToken));
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", tokens!.AccessToken);
        return client;
    }

    private sealed record LoginTokens(string AccessToken);
}
